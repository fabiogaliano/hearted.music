/**
 * Match review queue service.
 *
 * Owns: queue creation, resume, idempotent snapshot append, summary, and
 * item lifecycle transitions (presented / resolved).
 *
 * Reuses the existing derivation helpers from matching.functions.ts so that
 * queue ordering always matches the live match session ordering — the two code
 * paths agree by sharing one implementation, not by convention.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { stableStringify } from "@/lib/domains/enrichment/embeddings/hashing";
import { resolveMinMatchScore } from "@/lib/domains/library/accounts/preferences-queries";
import { getNewItemIds } from "@/lib/domains/library/liked-songs/status-queries";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { getMatchDecisionsForSongs } from "@/lib/domains/taste/song-matching/decision-queries";
import {
	getMatchResults,
	type MatchResultRow,
} from "@/lib/domains/taste/song-matching/queries";
import {
	DEFAULT_MATCH_STRICTNESS,
	STRICTNESS_MIN_SCORE,
	strictnessScore,
} from "@/lib/domains/taste/song-matching/strictness";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import { advanceActiveSession } from "./pass-advance";
import {
	clearSongNewness,
	countUnresolvedItems,
	fetchActiveSession,
	fetchAppliedSnapshotIds,
	fetchMaxPosition,
	fetchOwnedPlaylistIds,
	fetchPendingPlaylistIds,
	fetchPendingSongIds,
	fetchQueuedPlaylistIds,
	fetchQueuedSongIds,
	fetchTargetPlaylistFilters,
	insertMatchReviewSession,
	insertQueueItems,
	insertQueuePlaylistItems,
	insertSessionSnapshot,
	updateQueueItemPresented,
	updateQueueItemResolved,
} from "./queries";
import type {
	ActiveQueueResult,
	AppendResult,
	MatchOrientation,
	MatchReviewQueueItem,
	MatchReviewSession,
	MatchReviewSummary,
	OrderedSubject,
	QueueItemResolution,
	QueueItemState,
	QueueVisibilityConfigHashInput,
} from "./types";

interface UndecidedSong {
	songId: string;
	maxScore: number;
	isNew: boolean;
}

/**
 * Derives songs with at least one visible undecided match from raw data.
 * Extracted so tests can drive it without a DB.
 */
export function deriveUndecidedSongsForQueue(
	matchResults: Array<{
		song_id: string;
		playlist_id: string;
		score: number;
		fused_score: number | null;
	}>,
	decidedPairs: Set<string>,
	minScore: number,
	newSongIds: Set<string>,
): UndecidedSong[] {
	const songMap = new Map<
		string,
		{ maxScore: number; hasUndecided: boolean }
	>();

	for (const mr of matchResults) {
		const rowScore = strictnessScore(mr);
		if (rowScore < minScore) continue;
		const existing = songMap.get(mr.song_id) ?? {
			maxScore: 0,
			hasUndecided: false,
		};
		const isUndecided = !decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`);
		songMap.set(mr.song_id, {
			maxScore: Math.max(existing.maxScore, rowScore),
			hasUndecided: existing.hasUndecided || isUndecided,
		});
	}

	return Array.from(songMap.entries())
		.filter(([, v]) => v.hasUndecided)
		.map(([songId, v]) => ({
			songId,
			maxScore: v.maxScore,
			isNew: newSongIds.has(songId),
		}));
}

/**
 * Deterministic ordering: new songs first, max visible score desc, song id asc.
 * Mirrors the sort in getOrderedUndecidedSongIds so dashboard and queue agree.
 */
function sortSongsForQueue(songs: UndecidedSong[]): UndecidedSong[] {
	return songs.toSorted((a, b) => {
		const aNew = a.isNew ? 1 : 0;
		const bNew = b.isNew ? 1 : 0;
		if (aNew !== bNew) return bNew - aNew;
		if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
		return a.songId.localeCompare(b.songId);
	});
}

/**
 * Derives a deterministic string key from visibility inputs.
 *
 * orientation + strictness threshold + readTimeFiltersHash together determine
 * which subjects are visible in the queue at enqueue time. Stored in
 * match_review_session_snapshot so the same (snapshot, hash) is idempotent
 * while a changed hash allows append-without-duplication (C9).
 */
export function computeVisibilityConfigHash(
	input: QueueVisibilityConfigHashInput,
): string {
	return `vc_${input.orientation}_${input.minScore}_${input.readTimeFiltersHash}`;
}

/**
 * Derives a compact deterministic hash from the account's target playlist
 * read-time filter configs. Sorted by playlist ID so insertion order never
 * affects the hash. Used as the readTimeFiltersHash component of
 * QueueVisibilityConfigHashInput (C9, MSR-36).
 *
 * A djb2-style polynomial hash over the stable JSON representation is
 * sufficient for idempotency keying — no collision resistance is required
 * (same rationale as MSR-19's simple-string approach for visibility hash).
 */
export function computeReadTimeFiltersHash(
	filtersByPlaylistId: Map<string, PlaylistMatchFiltersV1 | null>,
): string {
	const sorted = [...filtersByPlaylistId.entries()].sort(([a], [b]) =>
		a.localeCompare(b),
	);
	const content = stableStringify(Object.fromEntries(sorted));
	let h = 0;
	for (let i = 0; i < content.length; i++) {
		h = (Math.imul(31, h) + content.charCodeAt(i)) | 0;
	}
	return `rtf_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

interface UndecidedPlaylist {
	playlistId: string;
	maxScore: number;
}

/**
 * Playlist-mode counterpart to deriveUndecidedSongsForQueue. Groups match
 * result rows by playlist_id (the review subject in playlist mode) and keeps
 * playlists that have at least one undecided song match above minScore.
 */
function deriveUndecidedPlaylistsForQueue(
	matchResults: MatchResultRow[],
	decidedPairs: Set<string>,
	minScore: number,
): UndecidedPlaylist[] {
	const playlistMap = new Map<
		string,
		{ maxScore: number; hasUndecided: boolean }
	>();

	for (const mr of matchResults) {
		const rowScore = strictnessScore(mr);
		if (rowScore < minScore) continue;
		const existing = playlistMap.get(mr.playlist_id) ?? {
			maxScore: 0,
			hasUndecided: false,
		};
		const isUndecided = !decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`);
		playlistMap.set(mr.playlist_id, {
			maxScore: Math.max(existing.maxScore, rowScore),
			hasUndecided: existing.hasUndecided || isUndecided,
		});
	}

	return Array.from(playlistMap.entries())
		.filter(([, v]) => v.hasUndecided)
		.map(([playlistId, v]) => ({
			playlistId,
			maxScore: v.maxScore,
		}));
}

/**
 * Derives orientation-aware ordered undecided queue subjects from snapshot
 * match data.
 *
 * Song mode (A2): newness desc → max strictness score desc → song id asc.
 * Playlist mode (A2): max strictness score desc → playlist id asc; subjects
 * always have wasNewAtEnqueue=false (playlists have no newness concept).
 *
 * Returns subjects plus hiddenReviewItemCount (A7): the count of undecided
 * subjects whose only matches sit below minScore. Entitlement filtering is the
 * caller's responsibility and not included in this count.
 *
 * Pure: no DB calls. Accepts the same MatchResultRow shape that getMatchResults
 * returns so callers share one query result.
 */
export function getOrderedUndecidedSubjects(
	matchResults: MatchResultRow[],
	decidedPairs: Set<string>,
	minScore: number,
	orientation: MatchOrientation,
	newSongIds: Set<string>,
): { subjects: OrderedSubject[]; hiddenReviewItemCount: number } {
	if (orientation === "song") {
		// Derive with minScore=0 to count all undecided songs regardless of threshold.
		const allUndecided = deriveUndecidedSongsForQueue(
			matchResults,
			decidedPairs,
			0,
			new Set(),
		);
		const visibleUndecided = deriveUndecidedSongsForQueue(
			matchResults,
			decidedPairs,
			minScore,
			newSongIds,
		);
		const hiddenReviewItemCount = allUndecided.length - visibleUndecided.length;
		const sorted = sortSongsForQueue(visibleUndecided);
		return {
			subjects: sorted.map((s) => ({
				subject: { orientation: "song" as const, songId: s.songId },
				maxScore: s.maxScore,
				wasNewAtEnqueue: s.isNew,
			})),
			hiddenReviewItemCount,
		};
	}

	// Playlist mode: subjects are playlists; newness not applicable.
	const allUndecided = deriveUndecidedPlaylistsForQueue(
		matchResults,
		decidedPairs,
		0,
	);
	const visibleUndecided = deriveUndecidedPlaylistsForQueue(
		matchResults,
		decidedPairs,
		minScore,
	);
	const hiddenReviewItemCount = allUndecided.length - visibleUndecided.length;

	// max score desc, playlist id asc — no newness tier in playlist mode.
	const sorted = visibleUndecided.toSorted((a, b) => {
		if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
		return a.playlistId.localeCompare(b.playlistId);
	});

	return {
		subjects: sorted.map((p) => ({
			subject: { orientation: "playlist" as const, playlistId: p.playlistId },
			maxScore: p.maxScore,
			// Playlist subjects never carry a newness flag (MSR-19 scope).
			wasNewAtEnqueue: false,
		})),
		hiddenReviewItemCount,
	};
}

/**
 * True once a session has either queued an item or recorded a snapshot as
 * applied. A just-inserted session has neither until its creator finishes the
 * initial append, so treating "0 unresolved" as caught-up before this check can
 * complete a session while the winning request is still seeding it.
 */
async function hasSessionBeenSeeded(
	sessionId: string,
): Promise<Result<boolean, DbError>> {
	const [appliedResult, maxPositionResult] = await Promise.all([
		fetchAppliedSnapshotIds(sessionId),
		fetchMaxPosition(sessionId),
	]);

	if (Result.isError(appliedResult)) return appliedResult;
	if (Result.isError(maxPositionResult)) return maxPositionResult;

	return Result.ok(
		appliedResult.value.size > 0 || maxPositionResult.value >= 0,
	);
}

async function fetchLatestSnapshotId(
	accountId: string,
): Promise<Result<string | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const snapshotResult = await supabase
		.from("match_snapshot")
		.select("id")
		.eq("account_id", accountId)
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	// A DB error here must propagate as a retryable failure — collapsing it into
	// no_snapshot would render the no-context/caught-up empty state on a transient
	// error, hiding the user's matches until the failure happened to clear.
	if (snapshotResult.error) {
		return Result.err(
			new DatabaseError({
				code: snapshotResult.error.code,
				message: snapshotResult.error.message,
			}),
		);
	}

	return Result.ok(snapshotResult.data?.id ?? null);
}

async function createQueueFromLatestSnapshot(
	accountId: string,
	orientation: MatchOrientation,
): Promise<Result<ActiveQueueResult, DbError>> {
	const snapshotIdResult = await fetchLatestSnapshotId(accountId);
	if (Result.isError(snapshotIdResult)) return snapshotIdResult;

	const snapshotId = snapshotIdResult.value;
	if (!snapshotId) {
		return Result.ok<ActiveQueueResult, DbError>({ kind: "no_snapshot" });
	}

	// Resolve strictness at session creation time — stored so mid-review setting
	// changes don't shift the bar on cards the user is already looking at.
	const minScore = await resolveMinMatchScore(accountId);
	const preset =
		Object.entries(STRICTNESS_MIN_SCORE).find(([, v]) => v === minScore)?.[0] ??
		DEFAULT_MATCH_STRICTNESS;

	const sessionResult = await insertMatchReviewSession(
		accountId,
		preset,
		minScore,
		orientation,
	);

	if (Result.isError(sessionResult)) {
		// Unique index violation: another request won the race for this orientation.
		// Fall back to the session the winner created for the same orientation — but
		// append the latest snapshot into it before returning. The winner may not have
		// populated its queue yet; returning the bare session here would let this
		// caller render an empty/caught-up queue for a pass that actually has matches.
		// appendLatestSnapshot is idempotent, so if the winner already appended this
		// is a no-op; its errors propagate so we never report a falsely-empty success.
		if (sessionResult.error._tag === "ConstraintError") {
			const active = await fetchActiveSession(accountId, orientation);
			if (Result.isError(active)) return active;
			if (active.value) {
				const syncResult = await appendLatestSnapshot(active.value, accountId);
				if (Result.isError(syncResult)) return syncResult;
				return Result.ok<ActiveQueueResult, DbError>({
					kind: "resumed",
					session: active.value,
				});
			}
		}
		return sessionResult;
	}

	const session = sessionResult.value;
	const appendResult = await appendSnapshotDelta(
		session,
		snapshotId,
		accountId,
	);

	// Propagate append failures instead of returning a successful empty queue. A
	// swallowed error here would mark the freshly created session "caught up" with
	// zero items, permanently hiding the snapshot's matches until another refresh.
	if (Result.isError(appendResult)) return appendResult;

	return Result.ok<ActiveQueueResult, DbError>({
		kind: "created",
		session,
		appendedCount: appendResult.value.appendedCount,
	});
}

/**
 * Ensures an active queue exists for the given (account, orientation) pair. If
 * one already exists it is returned as-is. Otherwise a new session is created,
 * the latest snapshot is appended, and the result describes what happened.
 *
 * "One active per orientation" is enforced by the unique partial index
 * `idx_match_review_session_one_active_per_orientation` (WHERE status = 'active').
 * Song-mode and playlist-mode passes are fully independent: a user may have one
 * active song session and one active playlist session simultaneously.
 *
 * A race between two concurrent creates for the same orientation produces a
 * ConstraintError on the insert; this function catches that and falls back to
 * fetchActiveSession so the caller always gets a valid session regardless of
 * which path won.
 *
 * Defaults to 'song' for backward compat with callers that pre-date MSR-18;
 * new callers should pass orientation explicitly.
 */
export async function createOrResumeQueue(
	accountId: string,
	orientation: MatchOrientation = "song",
): Promise<Result<ActiveQueueResult, DbError>> {
	const existing = await fetchActiveSession(accountId, orientation);
	if (Result.isError(existing)) return existing;

	if (existing.value) {
		const advanceResult = await advanceActiveSession(
			existing.value,
			accountId,
			appendLatestSnapshot,
			hasSessionBeenSeeded,
			(acctId) => createQueueFromLatestSnapshot(acctId, orientation),
		);
		if (Result.isError(advanceResult)) return advanceResult;

		const advance = advanceResult.value;
		if (advance.kind === "rolled-over-and-created") {
			return Result.ok<ActiveQueueResult, DbError>(advance.freshQueueResult);
		}
		return Result.ok<ActiveQueueResult, DbError>({
			kind: "resumed",
			session: advance.session,
		});
	}

	return createQueueFromLatestSnapshot(accountId, orientation);
}

/**
 * Records a (snapshot, visibility hash) pair as applied to a session, treating
 * a duplicate-key ConstraintError as a benign idempotency no-op (a concurrent
 * call already recorded it). Any other DB error propagates so a failed
 * snapshot recording never masquerades as a successful caught-up state.
 */
async function recordSnapshotApplied(
	sessionId: string,
	snapshotId: string,
	appendedItemCount: number,
	visibilityConfigHash: string,
): Promise<Result<void, DbError>> {
	const result = await insertSessionSnapshot(
		sessionId,
		snapshotId,
		appendedItemCount,
		visibilityConfigHash,
	);
	if (Result.isError(result) && result.error._tag !== "ConstraintError") {
		return result;
	}
	return Result.ok<void, DbError>(undefined);
}

/**
 * Fetches the account's most recent snapshot and appends its delta to the given
 * session. Returns appendedCount 0 when the account has no snapshot yet.
 *
 * Shared by createOrResumeQueue's resume path and syncActiveQueue so both use the
 * same "latest snapshot → append" logic. Strictness comes from the session row
 * (appendSnapshotDelta reads session.strictnessMinScore), so an active queue
 * keeps its stored bar regardless of live preference changes.
 *
 * A snapshot-fetch DB error propagates rather than being read as "no snapshot":
 * the caller decides whether to surface it, but no snapshot is ever marked
 * applied on failure.
 */
async function appendLatestSnapshot(
	session: MatchReviewSession,
	accountId: string,
): Promise<Result<AppendResult, DbError>> {
	const supabase = createAdminSupabaseClient();
	const snapshotResult = await supabase
		.from("match_snapshot")
		.select("id")
		.eq("account_id", accountId)
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	if (snapshotResult.error) {
		return Result.err(
			new DatabaseError({
				code: snapshotResult.error.code,
				message: snapshotResult.error.message,
			}),
		);
	}

	if (!snapshotResult.data) {
		return Result.ok<AppendResult, DbError>({
			appendedCount: 0,
			alreadyApplied: false,
		});
	}

	return appendSnapshotDelta(session, snapshotResult.data.id, accountId);
}

/**
 * Appends eligible subjects from a snapshot to an active session queue.
 *
 * The 9-step process from the plan:
 * 1. Load snapshot match results.
 * 2. Load account decisions for matched songs.
 * 3. Apply the session's stored strictness_min_score.
 * 4. Keep subjects with at least one visible undecided match (orientation-aware).
 * 5. Filter to entitled subjects: song mode by entitled review song; playlist
 *    mode by suggestion-side entitlement plus review-playlist ownership.
 * 6. Exclude subjects already in the active session queue.
 * 7. Sort (orientation-aware via getOrderedUndecidedSubjects).
 * 8. Append at max(position)+1.
 * 9. Insert session_snapshot row for idempotency, keyed by (snapshot, visibility hash).
 *
 * Idempotency: the composite PK on (session_id, snapshot_id, visibility_config_hash)
 * makes calling this twice with the same snapshot+hash a safe no-op. A new hash
 * (e.g. after strictness change) allows the same snapshot to append additional
 * subjects without duplicating already-enqueued ones (C9, MSR-19).
 */
export async function appendSnapshotDelta(
	session: MatchReviewSession,
	snapshotId: string,
	accountId: string,
): Promise<Result<AppendResult, DbError>> {
	// Fetch current read-time filter config to compute the visibility hash.
	// This is a lightweight query (only id + match_filters from target playlists).
	const targetFiltersResult = await fetchTargetPlaylistFilters(accountId);
	if (Result.isError(targetFiltersResult)) return targetFiltersResult;
	const readTimeFiltersHash = computeReadTimeFiltersHash(
		targetFiltersResult.value,
	);

	// Compute the visibility hash for this append — encodes which subjects are
	// visible given the session's orientation, strictness, and filter config.
	const visibilityHash = computeVisibilityConfigHash({
		orientation: session.orientation,
		minScore: session.strictnessMinScore,
		readTimeFiltersHash,
	});
	const appliedKey = `${snapshotId}:${visibilityHash}`;

	// Step 9 guard — check idempotency before doing any expensive work.
	const appliedResult = await fetchAppliedSnapshotIds(session.id);
	if (Result.isError(appliedResult)) return appliedResult;

	if (appliedResult.value.has(appliedKey)) {
		return Result.ok<AppendResult, DbError>({
			appendedCount: 0,
			alreadyApplied: true,
		});
	}

	// Step 1: load match results.
	const matchResultsResult = await getMatchResults(snapshotId);
	if (Result.isError(matchResultsResult)) return matchResultsResult;
	const matchResults = matchResultsResult.value;

	if (matchResults.length === 0) {
		const recorded = await recordSnapshotApplied(
			session.id,
			snapshotId,
			0,
			visibilityHash,
		);
		if (Result.isError(recorded)) return recorded;
		return Result.ok<AppendResult, DbError>({
			appendedCount: 0,
			alreadyApplied: false,
		});
	}

	// Step 2: load decisions for matched songs.
	const songIds = [...new Set(matchResults.map((mr) => mr.song_id))];
	const decisionsResult = await getMatchDecisionsForSongs(accountId, songIds);
	if (Result.isError(decisionsResult)) return decisionsResult;

	const decidedPairs = new Set(
		decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
	);

	// Steps 3+4+7: orientation-aware subject derivation (uses strictness score,
	// not legacy ordering score). Newness is fetched for song mode; in playlist
	// mode the newSongSet is unused (playlist subjects have wasNewAtEnqueue=false).
	const [newSongIdsResult, entitledResult, alreadyQueuedResult] =
		await Promise.all([
			getNewItemIds(accountId, "song"),
			createAdminSupabaseClient().rpc(
				"select_entitled_data_enriched_liked_song_ids",
				{ p_account_id: accountId },
			),
			// Step 6: load subjects already in this session queue. The already-queued
			// set is keyed by the orientation's subject column (song_id vs playlist_id).
			session.orientation === "song"
				? fetchQueuedSongIds(session.id)
				: fetchQueuedPlaylistIds(session.id),
		]);

	if (Result.isError(newSongIdsResult)) return newSongIdsResult;
	if (Result.isError(alreadyQueuedResult)) return alreadyQueuedResult;

	// An entitlement RPC failure must NOT be read as "nothing is entitled". Doing
	// so would derive an empty delta and then record the snapshot as applied,
	// permanently skipping every valid match for this snapshot. Surface it as a DB
	// error so no snapshot row is written and the next sync retries.
	if (entitledResult.error) {
		return Result.err(
			new DatabaseError({
				code: entitledResult.error.code,
				message: entitledResult.error.message,
			}),
		);
	}

	const newSongSet = new Set(newSongIdsResult.value);
	// Step 5: entitled songs — RPC's generated type already returns { song_id }[].
	const entitledSet = new Set<string>(
		(entitledResult.data ?? []).map((r) => r.song_id),
	);
	const alreadyQueued = alreadyQueuedResult.value;

	// Orientation-aware derivation: song mode preserves newness priority;
	// playlist mode uses max score then id (wasNewAtEnqueue always false).
	const { subjects } = getOrderedUndecidedSubjects(
		matchResults,
		decidedPairs,
		session.strictnessMinScore,
		session.orientation,
		newSongSet,
	);

	// Step 9 record-applied tail, shared across orientations: recording even a
	// zero-item append makes re-sync a no-op. A recording failure propagates —
	// better to retry than to falsely mark the snapshot applied.
	const recordAppliedAndReturn = async (
		count: number,
	): Promise<Result<AppendResult, DbError>> => {
		const recorded = await recordSnapshotApplied(
			session.id,
			snapshotId,
			count,
			visibilityHash,
		);
		if (Result.isError(recorded)) return recorded;
		return Result.ok<AppendResult, DbError>({
			appendedCount: count,
			alreadyApplied: false,
		});
	};

	// A concurrent append that slipped through the TOCTOU window can collide on
	// the (session_id, position) unique index, which the per-subject upsert does
	// not cover. Treat that single case as a safe no-op — the winner already
	// populated these positions; any other DB error propagates.
	const treatPositionRaceAsNoop = (
		error: DbError,
	): Result<AppendResult, DbError> =>
		error._tag === "ConstraintError"
			? Result.ok<AppendResult, DbError>({
					appendedCount: 0,
					alreadyApplied: true,
				})
			: Result.err(error);

	if (session.orientation === "song") {
		// Step 5/6: keep entitled song subjects not already in the queue.
		const candidates = subjects.flatMap((s) =>
			s.subject.orientation === "song" &&
			entitledSet.has(s.subject.songId) &&
			!alreadyQueued.has(s.subject.songId)
				? [
						{
							songId: s.subject.songId,
							maxScore: s.maxScore,
							wasNew: s.wasNewAtEnqueue,
						},
					]
				: [],
		);

		if (candidates.length === 0) return recordAppliedAndReturn(0);

		// Step 8: append at max(position)+1.
		const maxPosResult = await fetchMaxPosition(session.id);
		if (Result.isError(maxPosResult)) return maxPosResult;
		const startPosition = maxPosResult.value + 1;

		const items = candidates.map((c, i) => ({
			sessionId: session.id,
			accountId,
			songId: c.songId,
			sourceSnapshotId: snapshotId,
			position: startPosition + i,
			sourceScore: c.maxScore,
			wasNewAtEnqueue: c.wasNew,
		}));

		const insertResult = await insertQueueItems(items);
		if (Result.isError(insertResult))
			return treatPositionRaceAsNoop(insertResult.error);

		return recordAppliedAndReturn(items.length);
	}

	// Playlist mode (Finding 1): a subject is eligible only when its review
	// playlist still belongs to the account AND it still has at least one
	// entitled, undecided, visible song match — otherwise the card would render
	// with no actionable suggestion. Derivation already enforces undecided +
	// minScore; this adds the suggestion-side entitlement constraint.
	const entitledVisiblePlaylistIds = new Set<string>();
	for (const mr of matchResults) {
		if (!entitledSet.has(mr.song_id)) continue;
		if (strictnessScore(mr) < session.strictnessMinScore) continue;
		if (decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`)) continue;
		entitledVisiblePlaylistIds.add(mr.playlist_id);
	}

	// Preserve derivation order (max score desc, id asc) while applying the
	// entitlement + already-queued filters.
	const orderedCandidates = subjects.flatMap((s) =>
		s.subject.orientation === "playlist" &&
		entitledVisiblePlaylistIds.has(s.subject.playlistId) &&
		!alreadyQueued.has(s.subject.playlistId)
			? [{ playlistId: s.subject.playlistId, maxScore: s.maxScore }]
			: [],
	);

	// Ownership filter in a single query — drop playlists deleted or transferred
	// away since the snapshot was produced.
	const ownedResult = await fetchOwnedPlaylistIds(
		accountId,
		orderedCandidates.map((c) => c.playlistId),
	);
	if (Result.isError(ownedResult)) return ownedResult;
	const owned = ownedResult.value;
	const candidatePlaylists = orderedCandidates.filter((c) =>
		owned.has(c.playlistId),
	);

	if (candidatePlaylists.length === 0) return recordAppliedAndReturn(0);

	// Step 8: append at max(position)+1.
	const maxPosResult = await fetchMaxPosition(session.id);
	if (Result.isError(maxPosResult)) return maxPosResult;
	const startPosition = maxPosResult.value + 1;

	const items = candidatePlaylists.map((c, i) => ({
		sessionId: session.id,
		accountId,
		playlistId: c.playlistId,
		sourceSnapshotId: snapshotId,
		position: startPosition + i,
		sourceScore: c.maxScore,
		// Playlist subjects never carry a newness flag (MSR-19 scope).
		wasNewAtEnqueue: false,
	}));

	const insertResult = await insertQueuePlaylistItems(items);
	if (Result.isError(insertResult))
		return treatPositionRaceAsNoop(insertResult.error);

	return recordAppliedAndReturn(items.length);
}

/**
 * Appends any new snapshot's delta to the active queue for a given orientation,
 * if one exists. Used by the live-update path after background match refresh.
 * Returns { appendedCount: 0 } when no active queue exists for that orientation.
 *
 * Defaults to 'song' for backward compat with callers that pre-date MSR-18;
 * new callers should pass orientation explicitly.
 */
export async function syncActiveQueue(
	accountId: string,
	orientation: MatchOrientation = "song",
): Promise<Result<AppendResult, DbError>> {
	const sessionResult = await fetchActiveSession(accountId, orientation);
	if (Result.isError(sessionResult)) return sessionResult;
	if (!sessionResult.value) {
		return Result.ok<AppendResult, DbError>({
			appendedCount: 0,
			alreadyApplied: false,
		});
	}

	const advanceResult = await advanceActiveSession(
		sessionResult.value,
		accountId,
		appendLatestSnapshot,
		hasSessionBeenSeeded,
		(acctId) => createQueueFromLatestSnapshot(acctId, orientation),
	);
	if (Result.isError(advanceResult)) return advanceResult;

	const advance = advanceResult.value;
	if (
		advance.kind === "resumed-in-place" ||
		advance.kind === "appended-while-seeding"
	) {
		return Result.ok<AppendResult, DbError>(advance.appendResult);
	}

	if (advance.freshQueueResult.kind === "created") {
		return Result.ok<AppendResult, DbError>({
			appendedCount: advance.freshQueueResult.appendedCount,
			alreadyApplied: false,
		});
	}

	return Result.ok<AppendResult, DbError>({
		appendedCount: 0,
		alreadyApplied: false,
	});
}

/**
 * Returns queue summary for the given (account, orientation) pair. Drives
 * dashboard CTA, sidebar badge, and the match page empty/caught-up state.
 *
 * Falls back to empty/no-queue when no active session exists for the
 * orientation — the match page creates one on entry via createOrResumeQueue.
 *
 * Defaults to 'song' for backward compat with callers that pre-date MSR-18;
 * new callers should pass orientation explicitly.
 */
export async function getQueueSummary(
	accountId: string,
	orientation: MatchOrientation = "song",
): Promise<Result<MatchReviewSummary, DbError>> {
	const sessionResult = await fetchActiveSession(accountId, orientation);
	if (Result.isError(sessionResult)) return sessionResult;

	if (!sessionResult.value) {
		return Result.ok<MatchReviewSummary, DbError>({
			hasActiveQueue: false,
			pendingCount: 0,
			previewSubjectIds: [],
		});
	}

	const session = sessionResult.value;
	// Preview IDs are the orientation's subject: song IDs in song mode, playlist
	// IDs in playlist mode. Playlist-mode rows have song_id NULL, so the song
	// query would always return [] — the orientation-aware fetch is required.
	const [countResult, previewResult] = await Promise.all([
		countUnresolvedItems(session.id),
		session.orientation === "song"
			? fetchPendingSongIds(session.id, 3)
			: fetchPendingPlaylistIds(session.id, 3),
	]);

	if (Result.isError(countResult)) return countResult;
	if (Result.isError(previewResult)) return previewResult;

	return Result.ok<MatchReviewSummary, DbError>({
		hasActiveQueue: true,
		pendingCount: countResult.value,
		previewSubjectIds: previewResult.value,
	});
}

/**
 * Playlist counterpart to getOrderedUndecidedSongIds (matching.functions): the
 * no-active-queue summary fallback for playlist orientation (Finding 4). Derives
 * the ordered playlist subjects from a snapshot the same way the queue-append
 * path does — entitled + undecided + visible song match, review-playlist still
 * owned — so the dashboard/sidebar preview matches what the queue would enqueue.
 *
 * Returns Result so a transient DB failure surfaces as an error rather than a
 * falsely-empty preview.
 */
export async function getOrderedUndecidedPlaylistIds(
	snapshotId: string,
	accountId: string,
): Promise<Result<string[], DbError>> {
	const minScore = await resolveMinMatchScore(accountId);

	const [matchResultsResult, entitledResult] = await Promise.all([
		getMatchResults(snapshotId),
		createAdminSupabaseClient().rpc(
			"select_entitled_data_enriched_liked_song_ids",
			{ p_account_id: accountId },
		),
	]);
	if (Result.isError(matchResultsResult)) return matchResultsResult;
	if (entitledResult.error) {
		return Result.err(
			new DatabaseError({
				code: entitledResult.error.code,
				message: entitledResult.error.message,
			}),
		);
	}
	const matchResults = matchResultsResult.value;
	if (matchResults.length === 0) return Result.ok<string[], DbError>([]);

	const songIds = [...new Set(matchResults.map((mr) => mr.song_id))];
	const decisionsResult = await getMatchDecisionsForSongs(accountId, songIds);
	if (Result.isError(decisionsResult)) return decisionsResult;
	const decidedPairs = new Set(
		decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
	);

	const entitledSet = new Set<string>(
		(entitledResult.data ?? []).map((r) => r.song_id),
	);

	const entitledVisiblePlaylistIds = new Set<string>();
	for (const mr of matchResults) {
		if (!entitledSet.has(mr.song_id)) continue;
		if (strictnessScore(mr) < minScore) continue;
		if (decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`)) continue;
		entitledVisiblePlaylistIds.add(mr.playlist_id);
	}

	const { subjects } = getOrderedUndecidedSubjects(
		matchResults,
		decidedPairs,
		minScore,
		"playlist",
		new Set(),
	);

	const orderedIds = subjects.flatMap((s) =>
		s.subject.orientation === "playlist" &&
		entitledVisiblePlaylistIds.has(s.subject.playlistId)
			? [s.subject.playlistId]
			: [],
	);

	const ownedResult = await fetchOwnedPlaylistIds(accountId, orderedIds);
	if (Result.isError(ownedResult)) return ownedResult;
	const owned = ownedResult.value;

	return Result.ok<string[], DbError>(orderedIds.filter((id) => owned.has(id)));
}

/**
 * Marks a queue item as active: sets state=active, records presented_at,
 * and clears newness for the song durably.
 *
 * Newness clearing is best-effort — a failure must not fail the state
 * transition; the item is still marked active even if the newness write fails.
 */
export async function markItemPresented(
	itemId: string,
	accountId: string,
	songId: string,
): Promise<Result<MatchReviewQueueItem | null, DbError>> {
	const now = new Date().toISOString();
	const itemResult = await updateQueueItemPresented(itemId, accountId, now);
	if (Result.isError(itemResult)) return itemResult;

	// null means no eligible row was updated: the item is already resolved or
	// raced with finish/dismiss. The update is guarded by
	// .in("state", ["pending", "active"]) so a resolved card can never be
	// resurrected. Don't clear newness in that case — the card is not presented.
	if (itemResult.value === null) return itemResult;

	// Best-effort, but awaited: in a serverless handler a fire-and-forget promise
	// can be dropped when the function returns before it settles. Awaiting inside a
	// try/catch keeps the write reliable while still swallowing failures so a
	// newness-clear error never fails the presented transition.
	try {
		await clearSongNewness(accountId, songId, now);
	} catch {
		// Swallow — the item is presented regardless of whether newness cleared.
	}

	return itemResult;
}

/**
 * Marks a queue item as resolved. The DB state is always 'resolved' (B9-C);
 * the outcome is captured by `resolution`:
 *
 * - After one or more adds + finish: resolution=added
 * - After dismiss: resolution=dismissed
 * - Skip (next song with no adds): resolution=skipped
 * - Song became unavailable: resolution=unavailable
 *
 * `_legacyState` is accepted for backward-compatible call sites but is ignored
 * internally — `updateQueueItemResolved` always writes `state='resolved'`.
 *
 * Returns Result.ok(null) when the item was already resolved (the conditional
 * update in updateQueueItemResolved matched no unresolved row): a concurrent
 * finish/dismiss won the race, and the caller must not treat that as having
 * resolved the item itself.
 */
export async function markItemResolved(
	itemId: string,
	accountId: string,
	_legacyState: Extract<
		QueueItemState,
		"completed" | "skipped" | "unavailable"
	>,
	resolution: QueueItemResolution,
): Promise<Result<MatchReviewQueueItem | null, DbError>> {
	const now = new Date().toISOString();
	return updateQueueItemResolved(
		itemId,
		accountId,
		_legacyState,
		resolution,
		now,
	);
}

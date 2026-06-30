/**
 * Match review queue service.
 *
 * Owns: queue creation, resume, idempotent snapshot append, summary, and
 * item lifecycle transitions (presented / resolved).
 *
 * Queue derivation delegates to the shared visibility-policy layer
 * (review-subject-selector + visibility-policy), the same logic card
 * presentation uses, so a subject is queue-eligible exactly when at least one of
 * its pairs would be visible on the card.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { resolveMinMatchScore } from "@/lib/domains/library/accounts/preferences-queries";
import { getNewItemIds } from "@/lib/domains/library/liked-songs/status-queries";
import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import { getMatchDecisionsForSongs } from "@/lib/domains/taste/song-matching/decision-queries";
import {
	getMatchResults,
	type MatchResultRow,
} from "@/lib/domains/taste/song-matching/queries";
import {
	DEFAULT_MATCH_STRICTNESS,
	STRICTNESS_MIN_SCORE,
} from "@/lib/domains/taste/song-matching/strictness";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import { fetchSongsFilterMeta } from "./filter-metadata-queries";
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
import { getOrderedUndecidedSubjects } from "./review-subject-selector";
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
} from "./types";
import {
	computeVisibilityPolicyHash,
	type VisibilityPolicy,
} from "./visibility-policy";

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
 * Restricts snapshot match results to *eligible* pairs — song still entitled to
 * the account AND playlist still owned by it — before deriving ordered subjects
 * under the visibility policy.
 *
 * Eligibility is symmetric across orientation: a pair can only ever render on a
 * card when its song is entitled (the suggestion in playlist mode, the subject in
 * song mode) and its playlist is owned (the subject in playlist mode, the
 * suggestion in song mode). Pre-filtering here means the selector's ordering,
 * sourceScore, and hidden count all reflect exactly the pairs a card could show —
 * closing the gap where a non-entitled song or non-owned playlist drove ordering
 * or marked a subject queue-eligible that card visibility would later drop
 * (Findings 1 & 2).
 */
function deriveEligibleSubjects(input: {
	matchResults: MatchResultRow[];
	decidedPairs: ReadonlySet<string>;
	policy: VisibilityPolicy;
	entitledSongIds: ReadonlySet<string>;
	ownedPlaylistIds: ReadonlySet<string>;
	newSongIds: ReadonlySet<string>;
	songMetaBySongId: ReadonlyMap<string, SongFilterMetadata>;
	nowMs: number;
}): { subjects: OrderedSubject[]; hiddenReviewItemCount: number } {
	const eligible = input.matchResults.filter(
		(mr) =>
			input.entitledSongIds.has(mr.song_id) &&
			input.ownedPlaylistIds.has(mr.playlist_id),
	);
	return getOrderedUndecidedSubjects({ ...input, matchResults: eligible });
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
	// Fetch current read-time filter config to build the visibility policy.
	// This is a lightweight query (only id + match_filters from target playlists).
	const targetFiltersResult = await fetchTargetPlaylistFilters(accountId);
	if (Result.isError(targetFiltersResult)) return targetFiltersResult;

	// One policy drives both the hash and the subject derivation below: review
	// direction, the session's frozen strictness bar, and the target playlist
	// filters. Strictness is still session-frozen (read from the session row);
	// the policy isolates it so it can become live later without touching this path.
	const policy: VisibilityPolicy = {
		orientation: session.orientation,
		minScore: session.strictnessMinScore,
		filtersByPlaylistId: targetFiltersResult.value,
	};

	// One nowMs drives both the hash and the filter evaluation below, so a
	// liked-at "today" filter folds the same resolved UTC date into the
	// idempotency key that the visible set is computed against (Finding 3).
	const nowMs = Date.now();

	// The visibility hash encodes which subjects are visible under this policy.
	const visibilityHash = computeVisibilityPolicyHash(policy, nowMs);
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
	const playlistIds = [...new Set(matchResults.map((mr) => mr.playlist_id))];
	const decisionsResult = await getMatchDecisionsForSongs(accountId, songIds);
	if (Result.isError(decisionsResult)) return decisionsResult;

	const decidedPairs = new Set(
		decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
	);

	// Steps 3+4+5+7: load everything the eligibility-aware derivation needs.
	// Newness is fetched for song mode; in playlist mode the newSongSet is unused
	// (playlist subjects have wasNewAtEnqueue=false). Song filter metadata feeds
	// the policy's filter step. Entitled songs + owned playlists are the two
	// eligibility inputs: a pair only counts toward ordering/eligibility when its
	// song is entitled AND its playlist is owned, in both orientations — the same
	// constraints card visibility applies, so a subject is queue-eligible exactly
	// when a card could render it (Findings 1 & 2, M1).
	const [
		newSongIdsResult,
		entitledResult,
		alreadyQueuedResult,
		songMetaResult,
		ownedPlaylistsResult,
	] = await Promise.all([
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
		fetchSongsFilterMeta(accountId, songIds),
		fetchOwnedPlaylistIds(accountId, playlistIds),
	]);

	if (Result.isError(newSongIdsResult)) return newSongIdsResult;
	if (Result.isError(alreadyQueuedResult)) return alreadyQueuedResult;
	if (Result.isError(songMetaResult)) return songMetaResult;
	if (Result.isError(ownedPlaylistsResult)) return ownedPlaylistsResult;

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
	const songMetaBySongId = songMetaResult.value;
	const ownedPlaylistIds = ownedPlaylistsResult.value;

	// Eligibility-aware derivation under the policy: only pairs whose song is
	// entitled and whose playlist is owned drive ordering, sourceScore, and
	// eligibility. Song mode preserves newness priority; playlist mode uses max
	// score then id (wasNewAtEnqueue always false).
	const { subjects } = deriveEligibleSubjects({
		matchResults,
		decidedPairs,
		policy,
		entitledSongIds: entitledSet,
		ownedPlaylistIds,
		newSongIds: newSongSet,
		songMetaBySongId,
		nowMs,
	});

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
		// Step 6: subjects are already eligible (entitled song + owned suggestion
		// playlist, applied in deriveEligibleSubjects); just drop those already in
		// the queue.
		const candidates = subjects.flatMap((s) =>
			s.subject.orientation === "song" && !alreadyQueued.has(s.subject.songId)
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

	// Playlist mode: subjects are already eligible — review playlist owned AND at
	// least one entitled suggestion song visible under the policy (applied in
	// deriveEligibleSubjects, which also drives ordering off those eligible pairs
	// so a non-entitled song can't inflate a playlist's position). Drop those
	// already in the queue; derivation order (max score desc, id asc) is preserved.
	const candidatePlaylists = subjects.flatMap((s) =>
		s.subject.orientation === "playlist" &&
		!alreadyQueued.has(s.subject.playlistId)
			? [{ playlistId: s.subject.playlistId, maxScore: s.maxScore }]
			: [],
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
 * Song-orientation ordering authority for the no-active-queue summary fallback.
 *
 * Replaces the strictness-only derivation that previously lived in
 * matching.functions: that path ignored read-time playlist filters and playlist
 * ownership, so the song-mode dashboard preview and caught-up hidden count could
 * advertise songs the queue would never enqueue and the card would never render
 * (Finding 1). This derives song subjects the same way appendSnapshotDelta's song
 * path does — entitled song + owned suggestion playlist + visible undecided pair
 * under the live strictness bar and target filters — so the preview matches the
 * queue.
 *
 * hiddenReviewItemCount is the eligible-but-policy-hidden count: songs with at
 * least one entitled, owned-playlist, undecided pair whose only such pairs sit
 * below the strictness bar or fail the filters — the count the song-mode empty
 * state shows behind the "loosen strictness" nudge.
 *
 * minScoreOverride freezes the strictness bar to a caller-supplied value instead
 * of resolving the live preference. The active caught-up path passes the
 * session's stored strictnessMinScore so the hidden count is computed against the
 * exact bar the queue and cards use; the no-active dashboard fallback omits it to
 * preview against the user's current (live) strictness.
 *
 * Returns Result so a transient DB failure surfaces as an error rather than a
 * falsely-empty preview.
 */
export async function getOrderedUndecidedSongIds(
	snapshotId: string,
	accountId: string,
	minScoreOverride?: number,
): Promise<
	Result<{ songIds: string[]; hiddenReviewItemCount: number }, DbError>
> {
	const minScore = minScoreOverride ?? (await resolveMinMatchScore(accountId));

	const [
		matchResultsResult,
		newSongIdsResult,
		entitledResult,
		targetFiltersResult,
	] = await Promise.all([
		getMatchResults(snapshotId),
		getNewItemIds(accountId, "song"),
		createAdminSupabaseClient().rpc(
			"select_entitled_data_enriched_liked_song_ids",
			{ p_account_id: accountId },
		),
		fetchTargetPlaylistFilters(accountId),
	]);
	if (Result.isError(matchResultsResult)) return matchResultsResult;
	if (Result.isError(newSongIdsResult)) return newSongIdsResult;
	if (Result.isError(targetFiltersResult)) return targetFiltersResult;
	if (entitledResult.error) {
		return Result.err(
			new DatabaseError({
				code: entitledResult.error.code,
				message: entitledResult.error.message,
			}),
		);
	}
	const matchResults = matchResultsResult.value;
	if (matchResults.length === 0)
		return Result.ok({ songIds: [], hiddenReviewItemCount: 0 });

	const songIds = [...new Set(matchResults.map((mr) => mr.song_id))];
	const playlistIds = [...new Set(matchResults.map((mr) => mr.playlist_id))];
	const [decisionsResult, songMetaResult, ownedResult] = await Promise.all([
		getMatchDecisionsForSongs(accountId, songIds),
		fetchSongsFilterMeta(accountId, songIds),
		fetchOwnedPlaylistIds(accountId, playlistIds),
	]);
	if (Result.isError(decisionsResult)) return decisionsResult;
	if (Result.isError(songMetaResult)) return songMetaResult;
	if (Result.isError(ownedResult)) return ownedResult;

	const decidedPairs = new Set(
		decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
	);
	const entitledSet = new Set<string>(
		(entitledResult.data ?? []).map((r) => r.song_id),
	);
	const policy: VisibilityPolicy = {
		orientation: "song",
		minScore,
		filtersByPlaylistId: targetFiltersResult.value,
	};

	const { subjects, hiddenReviewItemCount } = deriveEligibleSubjects({
		matchResults,
		decidedPairs,
		policy,
		entitledSongIds: entitledSet,
		ownedPlaylistIds: ownedResult.value,
		newSongIds: new Set(newSongIdsResult.value),
		songMetaBySongId: songMetaResult.value,
		nowMs: Date.now(),
	});

	const orderedIds = subjects.flatMap((s) =>
		s.subject.orientation === "song" ? [s.subject.songId] : [],
	);

	return Result.ok({ songIds: orderedIds, hiddenReviewItemCount });
}

/**
 * Playlist counterpart to getOrderedUndecidedSongIds: the
 * no-active-queue summary fallback for playlist orientation (Finding 4). Derives
 * the ordered playlist subjects from a snapshot the same way the queue-append
 * path does — entitled suggestion song + owned review playlist + undecided +
 * visible pair under the policy — so the dashboard/sidebar preview matches what
 * the queue would enqueue. Routing through deriveEligibleSubjects means ordering
 * is driven only by eligible pairs: a high-scoring non-entitled (or non-owned)
 * pair can no longer inflate a playlist's position above one the queue ranks
 * higher.
 *
 * Also returns hiddenReviewItemCount: still-owned playlists with at least one
 * entitled, undecided song match whose only such matches sit below the
 * strictness bar or fail the filters. Computed entitlement- and ownership-aware
 * (the prefilter restricts both ordering and the hidden count to entitled+owned
 * pairs) so the playlist-mode empty state can offer the "loosen strictness"
 * nudge with a count that means owned playlists, not songs (A7, H9).
 *
 * minScoreOverride freezes the strictness bar to a caller-supplied value instead
 * of resolving the live preference — the active caught-up path passes the
 * session's stored strictnessMinScore so the hidden count matches the queue/card
 * policy, while the no-active dashboard fallback omits it to preview against live
 * strictness (see getOrderedUndecidedSongIds).
 *
 * Returns Result so a transient DB failure surfaces as an error rather than a
 * falsely-empty preview.
 */
export async function getOrderedUndecidedPlaylistIds(
	snapshotId: string,
	accountId: string,
	minScoreOverride?: number,
): Promise<
	Result<{ playlistIds: string[]; hiddenReviewItemCount: number }, DbError>
> {
	const minScore = minScoreOverride ?? (await resolveMinMatchScore(accountId));

	const [matchResultsResult, entitledResult, targetFiltersResult] =
		await Promise.all([
			getMatchResults(snapshotId),
			createAdminSupabaseClient().rpc(
				"select_entitled_data_enriched_liked_song_ids",
				{ p_account_id: accountId },
			),
			fetchTargetPlaylistFilters(accountId),
		]);
	if (Result.isError(matchResultsResult)) return matchResultsResult;
	if (Result.isError(targetFiltersResult)) return targetFiltersResult;
	if (entitledResult.error) {
		return Result.err(
			new DatabaseError({
				code: entitledResult.error.code,
				message: entitledResult.error.message,
			}),
		);
	}
	const matchResults = matchResultsResult.value;
	if (matchResults.length === 0)
		return Result.ok({ playlistIds: [], hiddenReviewItemCount: 0 });

	const songIds = [...new Set(matchResults.map((mr) => mr.song_id))];
	const playlistIds = [...new Set(matchResults.map((mr) => mr.playlist_id))];
	// Ownership is fetched alongside the per-song queries — before the selector —
	// so the eligibility prefilter can drop non-owned pairs, the same as the song
	// fallback and the queue-append path. A stale snapshot can still reference a
	// deleted/transferred playlist, which must drive neither ordering nor counts.
	const [decisionsResult, songMetaResult, ownedResult] = await Promise.all([
		getMatchDecisionsForSongs(accountId, songIds),
		fetchSongsFilterMeta(accountId, songIds),
		fetchOwnedPlaylistIds(accountId, playlistIds),
	]);
	if (Result.isError(decisionsResult)) return decisionsResult;
	if (Result.isError(songMetaResult)) return songMetaResult;
	if (Result.isError(ownedResult)) return ownedResult;
	const decidedPairs = new Set(
		decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
	);

	const entitledSet = new Set<string>(
		(entitledResult.data ?? []).map((r) => r.song_id),
	);

	// Same visibility policy the queue-append path builds, so this preview matches
	// what the queue would enqueue: orientation, the live strictness bar, and the
	// account's target playlist filters.
	const policy: VisibilityPolicy = {
		orientation: "playlist",
		minScore,
		filtersByPlaylistId: targetFiltersResult.value,
	};

	// Eligibility-aware derivation: only entitled-song + owned-playlist pairs drive
	// ordering, sourceScore, and the hidden count — closing the gap where a
	// non-entitled pair's score could reorder a playlist preview relative to the
	// queue (which prefilters the same way in appendSnapshotDelta).
	const { subjects, hiddenReviewItemCount } = deriveEligibleSubjects({
		matchResults,
		decidedPairs,
		policy,
		entitledSongIds: entitledSet,
		ownedPlaylistIds: ownedResult.value,
		newSongIds: new Set(),
		songMetaBySongId: songMetaResult.value,
		nowMs: Date.now(),
	});

	const orderedIds = subjects.flatMap((s) =>
		s.subject.orientation === "playlist" ? [s.subject.playlistId] : [],
	);

	return Result.ok({ playlistIds: orderedIds, hiddenReviewItemCount });
}

/**
 * Answers: "Would the latest snapshot or an active queue produce at least one
 * visible unresolved review subject in either orientation under current
 * visibility policy?"
 *
 * This is the authoritative first-visible-match readiness check. It is
 * deliberately coarser than per-session visibility because its purpose is
 * "any card could render" — it does not freeze strictness to a session bar.
 * The live resolveMinMatchScore is used for the snapshot fallback, matching
 * the existing no-active-queue dashboard preview behavior.
 *
 * Order of checks:
 * 1. Active queue summaries for both orientations in parallel — a pending
 *    item means a visible subject already exists; short-circuit immediately.
 * 2. Latest snapshot via fetchLatestSnapshotId — no snapshot ⇒ false.
 * 3. Snapshot-derived subjects for both orientations (reusing
 *    getOrderedUndecidedSongIds / getOrderedUndecidedPlaylistIds, which apply
 *    the full entitlement + ownership + strictness + filter + decision logic).
 *
 * DB errors propagate as Result.err — they must not be read as "not ready."
 */
export async function hasFirstVisibleReviewSubject(
	accountId: string,
): Promise<Result<boolean, DbError>> {
	// Step 1: active queue summaries tell us if pending items already exist.
	const [songSummaryResult, playlistSummaryResult] = await Promise.all([
		getQueueSummary(accountId, "song"),
		getQueueSummary(accountId, "playlist"),
	]);

	if (Result.isError(songSummaryResult)) return songSummaryResult;
	if (Result.isError(playlistSummaryResult)) return playlistSummaryResult;

	if (
		songSummaryResult.value.pendingCount > 0 ||
		playlistSummaryResult.value.pendingCount > 0
	) {
		return Result.ok(true);
	}

	// Step 2: fall back to snapshot — load via the private helper so the
	// error-vs-no-snapshot distinction is preserved (same pattern as
	// createQueueFromLatestSnapshot).
	const snapshotIdResult = await fetchLatestSnapshotId(accountId);
	if (Result.isError(snapshotIdResult)) return snapshotIdResult;

	const snapshotId = snapshotIdResult.value;
	if (!snapshotId) {
		return Result.ok(false);
	}

	// Step 3: neither orientation has a pending active queue, so check whether
	// the snapshot would produce visible subjects. Both helpers are independent;
	// run them in parallel to avoid serial latency.
	const [songSubjectsResult, playlistSubjectsResult] = await Promise.all([
		getOrderedUndecidedSongIds(snapshotId, accountId),
		getOrderedUndecidedPlaylistIds(snapshotId, accountId),
	]);

	if (Result.isError(songSubjectsResult)) return songSubjectsResult;
	if (Result.isError(playlistSubjectsResult)) return playlistSubjectsResult;

	return Result.ok(
		songSubjectsResult.value.songIds.length > 0 ||
			playlistSubjectsResult.value.playlistIds.length > 0,
	);
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

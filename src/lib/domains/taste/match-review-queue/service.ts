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
import { resolveMinMatchScore } from "@/lib/domains/library/accounts/preferences-queries";
import { getNewItemIds } from "@/lib/domains/library/liked-songs/status-queries";
import { getMatchDecisionsForSongs } from "@/lib/domains/taste/song-matching/decision-queries";
import { getMatchResults } from "@/lib/domains/taste/song-matching/queries";
import {
	DEFAULT_MATCH_STRICTNESS,
	STRICTNESS_MIN_SCORE,
} from "@/lib/domains/taste/song-matching/strictness";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	clearSongNewness,
	completeSession,
	countUnresolvedItems,
	fetchActiveSession,
	fetchAppliedSnapshotIds,
	fetchMaxPosition,
	fetchPendingSongIds,
	fetchQueuedSongIds,
	insertMatchReviewSession,
	insertQueueItems,
	insertSessionSnapshot,
	updateQueueItemPresented,
	updateQueueItemResolved,
} from "./queries";
import type {
	ActiveQueueResult,
	AppendResult,
	MatchReviewQueueItem,
	MatchReviewSession,
	MatchReviewSummary,
	QueueItemResolution,
	QueueItemState,
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
	matchResults: Array<{ song_id: string; playlist_id: string; score: number }>,
	decidedPairs: Set<string>,
	minScore: number,
	newSongIds: Set<string>,
): UndecidedSong[] {
	const songMap = new Map<
		string,
		{ maxScore: number; hasUndecided: boolean }
	>();

	for (const mr of matchResults) {
		if (mr.score < minScore) continue;
		const existing = songMap.get(mr.song_id) ?? {
			maxScore: 0,
			hasUndecided: false,
		};
		const isUndecided = !decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`);
		songMap.set(mr.song_id, {
			maxScore: Math.max(existing.maxScore, mr.score),
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
	);

	if (Result.isError(sessionResult)) {
		// Unique index violation: another request won the race. Fall back to the
		// session the winner created — but append the latest snapshot into it before
		// returning. The winner may not have populated its queue yet; returning the
		// bare session here would let this caller render an empty/caught-up queue for
		// a pass that actually has matches. appendLatestSnapshot is idempotent, so if
		// the winner already appended this is a no-op; its errors propagate so we
		// never report a falsely-empty success.
		if (sessionResult.error._tag === "ConstraintError") {
			const active = await fetchActiveSession(accountId);
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
 * Ensures an active queue exists for the account. If one already exists it is
 * returned as-is. Otherwise a new session is created, the latest snapshot is
 * appended, and the result describes what happened.
 *
 * "One active per account" is enforced by the unique partial index
 * `idx_match_review_session_one_active` (WHERE status = 'active'). A race
 * between two concurrent creates produces a ConstraintError on the insert;
 * this function catches that and falls back to fetchActiveSession so the
 * caller always gets a valid session regardless of which path won.
 */
export async function createOrResumeQueue(
	accountId: string,
): Promise<Result<ActiveQueueResult, DbError>> {
	const existing = await fetchActiveSession(accountId);
	if (Result.isError(existing)) return existing;

	if (existing.value) {
		const session = existing.value;

		// Is this pass still in progress? Count unresolved (pending/presented) items.
		const unresolvedResult = await countUnresolvedItems(session.id);
		if (Result.isError(unresolvedResult)) return unresolvedResult;

		if (unresolvedResult.value > 0) {
			// Pass in progress. Sync the latest snapshot into the existing queue
			// before returning. If the browser missed the live-append effect after a
			// background refresh, route entry is the recovery point — without this,
			// new matches would only appear after another refresh completion.
			// appendSnapshotDelta uses the session's STORED strictness (never live
			// preferences) and is idempotent, so a snapshot already applied is a no-op
			// and the current card is never disturbed.
			//
			// A DB/RPC failure here propagates rather than silently reporting caught-up:
			// the snapshot is not marked applied, so the next entry retries cleanly.
			const syncResult = await appendLatestSnapshot(session, accountId);
			if (Result.isError(syncResult)) return syncResult;

			return Result.ok<ActiveQueueResult, DbError>({
				kind: "resumed",
				session,
			});
		}

		const seededResult = await hasSessionBeenSeeded(session.id);
		if (Result.isError(seededResult)) return seededResult;

		if (!seededResult.value) {
			// First-creation race: another request inserted the active session but has
			// not appended its first snapshot yet. Sync it here and return the same
			// session instead of completing it as caught-up; otherwise the creator can
			// append items into a session this request just completed.
			const syncResult = await appendLatestSnapshot(session, accountId);
			if (Result.isError(syncResult)) return syncResult;

			return Result.ok<ActiveQueueResult, DbError>({
				kind: "resumed",
				session,
			});
		}

		// Caught up: every item in this pass is resolved. Complete the pass so a
		// fresh one can re-offer skipped songs — the plan's "new pass created lazily
		// on /match entry" rollover. Skip writes no decision, so the new pass derives
		// a previously-skipped song as eligible again, while added/dismissed pairs
		// stay excluded by their decisions. Completing must happen BEFORE the insert
		// below: the partial unique index idx_match_review_session_one_active rejects
		// a second active row, so this session has to leave 'active' first. A
		// concurrent rollover that already completed it returns null here — harmless;
		// we still fall through and the one-active index plus the ConstraintError
		// fallback below resolve the race.
		//
		// Trade-off (minimal rollover, no cooldown): when there is nothing new to
		// offer this churns one completed + one empty active session per caught-up
		// entry. Acceptable because /match entry is user-initiated, not polled.
		const completeResult = await completeSession(session.id, accountId);
		if (Result.isError(completeResult)) return completeResult;
		// Fall through to create a fresh active pass from the latest snapshot.
	}

	return createQueueFromLatestSnapshot(accountId);
}

/**
 * Records a snapshot as applied to a session, treating a duplicate-key
 * ConstraintError as a benign idempotency no-op (a concurrent call already
 * recorded it). Any other DB error propagates so a failed snapshot recording
 * never masquerades as a successful caught-up state.
 */
async function recordSnapshotApplied(
	sessionId: string,
	snapshotId: string,
	appendedItemCount: number,
): Promise<Result<void, DbError>> {
	const result = await insertSessionSnapshot(
		sessionId,
		snapshotId,
		appendedItemCount,
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
 * Appends eligible songs from a snapshot to an active session queue.
 *
 * The 9-step process from the plan:
 * 1. Load snapshot match results.
 * 2. Load account decisions for matched songs.
 * 3. Apply the session's stored strictness_min_score.
 * 4. Keep songs with at least one visible undecided match.
 * 5. Filter to currently entitled songs (via RPC).
 * 6. Exclude songs already in the active session queue.
 * 7. Sort: new songs first, max visible score desc, song id asc.
 * 8. Append at max(position)+1.
 * 9. Insert session_snapshot row for idempotency.
 *
 * Idempotency: the composite PK on (session_id, snapshot_id) in
 * match_review_session_snapshot means calling this twice with the same
 * snapshot is a safe no-op — the second call sees `alreadyApplied: true`.
 */
export async function appendSnapshotDelta(
	session: MatchReviewSession,
	snapshotId: string,
	accountId: string,
): Promise<Result<AppendResult, DbError>> {
	// Step 9 guard — check idempotency before doing any expensive work.
	const appliedResult = await fetchAppliedSnapshotIds(session.id);
	if (Result.isError(appliedResult)) return appliedResult;

	if (appliedResult.value.has(snapshotId)) {
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
		const recorded = await recordSnapshotApplied(session.id, snapshotId, 0);
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

	// Step 3+4: apply session strictness, keep songs with visible undecided match.
	// Step 7 ordering also needs newness, so fetch in parallel.
	const [newSongIdsResult, entitledResult, alreadyQueuedResult] =
		await Promise.all([
			getNewItemIds(accountId, "song"),
			createAdminSupabaseClient().rpc(
				"select_entitled_data_enriched_liked_song_ids",
				{ p_account_id: accountId },
			),
			// Step 6: load songs already in this session queue.
			fetchQueuedSongIds(session.id),
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
	// Step 5: entitled songs — RPC returns { song_id }[].
	const entitledSet = new Set<string>(
		(entitledResult.data
			? (entitledResult.data as { song_id: string }[])
			: []
		).map((r) => r.song_id),
	);
	const alreadyQueued = alreadyQueuedResult.value;

	const candidates = deriveUndecidedSongsForQueue(
		matchResults,
		decidedPairs,
		session.strictnessMinScore,
		newSongSet,
	)
		// Step 5: filter to entitled songs.
		.filter((s) => entitledSet.has(s.songId))
		// Step 6: exclude songs already in queue.
		.filter((s) => !alreadyQueued.has(s.songId));

	// Step 7: deterministic sort.
	const ordered = sortSongsForQueue(candidates);

	if (ordered.length === 0) {
		// Record the snapshot even when no items are added so re-sync is a no-op.
		// A recording failure propagates — better to retry than to falsely mark the
		// snapshot applied with zero items.
		const recorded = await recordSnapshotApplied(session.id, snapshotId, 0);
		if (Result.isError(recorded)) return recorded;
		return Result.ok<AppendResult, DbError>({
			appendedCount: 0,
			alreadyApplied: false,
		});
	}

	// Step 8: append at max(position)+1.
	const maxPosResult = await fetchMaxPosition(session.id);
	if (Result.isError(maxPosResult)) return maxPosResult;
	const startPosition = maxPosResult.value + 1;

	const items = ordered.map((song, i) => ({
		sessionId: session.id,
		accountId,
		songId: song.songId,
		sourceSnapshotId: snapshotId,
		position: startPosition + i,
		sourceScore: song.maxScore,
		wasNewAtEnqueue: song.isNew,
	}));

	const insertResult = await insertQueueItems(items);
	if (Result.isError(insertResult)) {
		// The (session_id, position) unique index is not covered by the song-level
		// upsert in insertQueueItems. A concurrent append that slipped through the
		// TOCTOU window can still collide on position. Treat it as a safe no-op:
		// the concurrent winner already populated these positions.
		if (insertResult.error._tag === "ConstraintError") {
			return Result.ok<AppendResult, DbError>({
				appendedCount: 0,
				alreadyApplied: true,
			});
		}
		return insertResult;
	}

	// Step 9: record that this snapshot has been applied. A duplicate-key
	// ConstraintError means a concurrent call beat us — that's fine; the items
	// from the winner are already in the queue. Any other error propagates.
	const recorded = await recordSnapshotApplied(
		session.id,
		snapshotId,
		ordered.length,
	);
	if (Result.isError(recorded)) return recorded;

	return Result.ok<AppendResult, DbError>({
		appendedCount: ordered.length,
		alreadyApplied: false,
	});
}

/**
 * Appends any new snapshot's delta to the active queue, if one exists.
 * Used by the live-update path after background match refresh completes.
 * Returns { appendedCount: 0 } when there is no active queue.
 */
export async function syncActiveQueue(
	accountId: string,
): Promise<Result<AppendResult, DbError>> {
	const sessionResult = await fetchActiveSession(accountId);
	if (Result.isError(sessionResult)) return sessionResult;
	if (!sessionResult.value) {
		return Result.ok<AppendResult, DbError>({
			appendedCount: 0,
			alreadyApplied: false,
		});
	}

	const session = sessionResult.value;
	const unresolvedResult = await countUnresolvedItems(session.id);
	if (Result.isError(unresolvedResult)) return unresolvedResult;

	if (unresolvedResult.value > 0) {
		return appendLatestSnapshot(session, accountId);
	}

	const seededResult = await hasSessionBeenSeeded(session.id);
	if (Result.isError(seededResult)) return seededResult;

	if (!seededResult.value) {
		// A create/resume request can expose a zero-item active session before its
		// initial append finishes. Do the same recovery append as route entry, but do
		// not roll it over as caught-up yet.
		return appendLatestSnapshot(session, accountId);
	}

	// The active pass is caught up. Complete it before deriving the latest snapshot
	// so skipped songs are no longer excluded by "already queued in this session"
	// and can return in the new pass. This keeps dashboard/sidebar counts fresh
	// after background refreshes, even if the user does not re-enter /match.
	const completeResult = await completeSession(session.id, accountId);
	if (Result.isError(completeResult)) return completeResult;

	const freshQueueResult = await createQueueFromLatestSnapshot(accountId);
	if (Result.isError(freshQueueResult)) return freshQueueResult;

	if (freshQueueResult.value.kind === "created") {
		return Result.ok<AppendResult, DbError>({
			appendedCount: freshQueueResult.value.appendedCount,
			alreadyApplied: false,
		});
	}

	return Result.ok<AppendResult, DbError>({
		appendedCount: 0,
		alreadyApplied: false,
	});
}

/**
 * Returns queue summary for the account. Drives dashboard CTA, sidebar badge,
 * and the match page empty/caught-up state.
 *
 * Falls back to empty/no-queue when no active session exists — the match page
 * creates one on entry via createOrResumeQueue.
 */
export async function getQueueSummary(
	accountId: string,
): Promise<Result<MatchReviewSummary, DbError>> {
	const sessionResult = await fetchActiveSession(accountId);
	if (Result.isError(sessionResult)) return sessionResult;

	if (!sessionResult.value) {
		return Result.ok<MatchReviewSummary, DbError>({
			hasActiveQueue: false,
			pendingCount: 0,
			previewSongIds: [],
		});
	}

	const session = sessionResult.value;
	const [countResult, previewResult] = await Promise.all([
		countUnresolvedItems(session.id),
		fetchPendingSongIds(session.id, 3),
	]);

	if (Result.isError(countResult)) return countResult;
	if (Result.isError(previewResult)) return previewResult;

	return Result.ok<MatchReviewSummary, DbError>({
		hasActiveQueue: true,
		pendingCount: countResult.value,
		previewSongIds: previewResult.value,
	});
}

/**
 * Marks a queue item as presented: sets state=presented, records presented_at,
 * and clears newness for the song durably.
 *
 * Newness clearing is best-effort — a failure must not fail the state
 * transition; the item is still marked presented even if the newness write
 * fails.
 */
export async function markItemPresented(
	itemId: string,
	accountId: string,
	songId: string,
): Promise<Result<MatchReviewQueueItem | null, DbError>> {
	const now = new Date().toISOString();
	const itemResult = await updateQueueItemPresented(itemId, accountId, now);
	if (Result.isError(itemResult)) return itemResult;

	// null means no eligible row was updated: the item is already resolved
	// (completed/skipped/unavailable) or raced with finish/dismiss. The update
	// is guarded by .in("state", ["pending", "presented"]) so a resolved card
	// can never be resurrected to "presented". Don't clear newness in that case —
	// the card is no longer being presented.
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
 * Marks a queue item as resolved. The caller supplies the final state and
 * resolution based on the decision type:
 *
 * - After one or more adds + finish: state=completed, resolution=added
 * - After dismiss: state=completed, resolution=dismissed
 * - Skip (next song with no adds): state=skipped, resolution=skipped
 * - Song became unavailable: state=unavailable, resolution=unavailable
 *
 * Returns Result.ok(null) when the item was already resolved (the conditional
 * update in updateQueueItemResolved matched no unresolved row): a concurrent
 * finish/dismiss won the race, and the caller must not treat that as having
 * resolved the item itself.
 */
export async function markItemResolved(
	itemId: string,
	accountId: string,
	state: Extract<QueueItemState, "completed" | "skipped" | "unavailable">,
	resolution: QueueItemResolution,
): Promise<Result<MatchReviewQueueItem | null, DbError>> {
	const now = new Date().toISOString();
	return updateQueueItemResolved(itemId, accountId, state, resolution, now);
}

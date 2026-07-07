/**
 * Match review queue service.
 *
 * Owns: queue summary, the no-active-queue snapshot ordering fallback
 * (getOrderedUndecided*), first-visible-match readiness, and item lifecycle
 * transitions (presented / resolved). Request-path queue creation/resume and
 * snapshot append moved to the deck read model (worker-driven proposals +
 * append_sessions jobs).
 *
 * Subject ordering delegates to the shared visibility-policy layer
 * (deriveEligibleSubjects + visibility-policy), the same logic card presentation
 * uses, so a subject is queue-eligible exactly when at least one of its pairs
 * would be visible on the card.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { resolveMinMatchScore } from "@/lib/domains/library/accounts/preferences-queries";
import { getNewItemIds } from "@/lib/domains/library/liked-songs/status-queries";
import { getMatchDecisionsForSongs } from "@/lib/domains/taste/song-matching/decision-queries";
import { getMatchResults } from "@/lib/domains/taste/song-matching/queries";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import { deriveEligibleSubjects } from "./eligible-subjects";
import { fetchSongsFilterMeta } from "./filter-metadata-queries";
import {
	clearSongNewness,
	countUnresolvedItems,
	fetchActiveSession,
	fetchOwnedPlaylistIds,
	fetchPendingPlaylistIds,
	fetchPendingSongIds,
	fetchTargetPlaylistFilters,
	updateQueueItemPresented,
	updateQueueItemResolved,
} from "./queries";
import type {
	MatchOrientation,
	MatchReviewQueueItem,
	MatchReviewSummary,
	QueueItemResolution,
	QueueItemState,
} from "./types";
import type { VisibilityPolicy } from "./visibility-policy";

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
	// Fold the strictness resolve into the parallel batch (P3): minScore isn't
	// needed until the policy is built after these reads, so awaiting it first only
	// added serial latency. When an override is passed, use it directly — Promise.all
	// passes a plain number through unchanged. `??` (not `||`) so a 0 override holds.
	const [
		minScore,
		matchResultsResult,
		newSongIdsResult,
		entitledResult,
		targetFiltersResult,
	] = await Promise.all([
		minScoreOverride ?? resolveMinMatchScore(accountId),
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
	// Fold the strictness resolve into the parallel batch (P3): minScore isn't
	// needed until the policy is built after these reads. Override passes through
	// Promise.all unchanged; `??` (not `||`) so a 0 override holds.
	const [minScore, matchResultsResult, entitledResult, targetFiltersResult] =
		await Promise.all([
			minScoreOverride ?? resolveMinMatchScore(accountId),
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

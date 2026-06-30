/**
 * Match decision data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Tables } from "@/lib/data/database.types";
import type { DbError } from "@/lib/shared/errors/database";
import { chunkedRead } from "@/lib/shared/utils/chunked-read";
import {
	fromSupabaseMany,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";

export type MatchDecision = Tables<"match_decision">;
type DecisionType = "added" | "dismissed";

/**
 * Upserts a single match decision.
 * On conflict (same account + song + playlist), updates the decision and decided_at.
 *
 * `served` records the ranking the user acted on (matching roadmap #6). Both
 * fields are nullable: the server resolves them best-effort and passes null when
 * the served snapshot can't be tied to a match_result — never blocking the
 * decision. A null `modelRank` under a non-null `snapshotId` is the signal
 * that the (song, playlist) pair was never surfaced in that snapshot.
 *
 * `queueItemId` links the decision back to the queue item it was made from.
 * Nullable — decisions made outside the queue path (legacy add/dismiss) omit it.
 */
export function upsertMatchDecision(
	accountId: string,
	songId: string,
	playlistId: string,
	decision: DecisionType,
	served?: {
		snapshotId?: string | null;
		modelRank?: number | null;
		queueItemId?: string | null;
	},
): Promise<Result<MatchDecision, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("match_decision")
			.upsert(
				{
					account_id: accountId,
					song_id: songId,
					playlist_id: playlistId,
					decision,
					decided_at: new Date().toISOString(),
					snapshot_id: served?.snapshotId ?? null,
					model_rank: served?.modelRank ?? null,
					queue_item_id: served?.queueItemId ?? null,
				},
				{ onConflict: "account_id,song_id,playlist_id" },
			)
			.select()
			.single(),
	);
}

/**
 * Batch upserts match decisions.
 * On conflict (same account + song + playlist), updates the decision and decided_at.
 *
 * Per-decision `snapshotId` / `modelRank` carry the served-ranking context (see
 * `upsertMatchDecision`). A dismiss spans many playlists in one snapshot: those
 * with a match_result carry `modelRank` (surfaced negatives), the rest null it
 * (implicit negatives) — both kept distinct in the same batch.
 *
 * `queueItemId` links each decision back to the queue item it was made from.
 * Nullable — decisions made outside the queue path (legacy dismiss) omit it.
 */
export function upsertMatchDecisions(
	decisions: {
		accountId: string;
		songId: string;
		playlistId: string;
		decision: DecisionType;
		snapshotId?: string | null;
		modelRank?: number | null;
		queueItemId?: string | null;
	}[],
): Promise<Result<MatchDecision[], DbError>> {
	if (decisions.length === 0) {
		return Promise.resolve(Result.ok<MatchDecision[], DbError>([]));
	}

	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_decision")
			.upsert(
				decisions.map((d) => ({
					account_id: d.accountId,
					song_id: d.songId,
					playlist_id: d.playlistId,
					decision: d.decision,
					decided_at: new Date().toISOString(),
					snapshot_id: d.snapshotId ?? null,
					model_rank: d.modelRank ?? null,
					queue_item_id: d.queueItemId ?? null,
				})),
				{ onConflict: "account_id,song_id,playlist_id" },
			)
			.select(),
	);
}

/**
 * Gets all match decisions for an account.
 * Returns empty array if none found.
 */
export function getMatchDecisions(
	accountId: string,
): Promise<Result<MatchDecision[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_decision")
			.select("*")
			.eq("account_id", accountId)
			.order("decided_at", { ascending: false }),
	);
}

/**
 * Gets match decisions for specific songs belonging to an account.
 * Returns empty array if none found.
 *
 * The snapshot-derived song set can be large (hundreds to the 1000-row cap), so
 * the ids are chunked: PostgREST encodes `.in()` values into the query string,
 * and an unbounded list overflows the URI-length limit (URI too long). Each
 * chunk runs as its own request under bounded concurrency, then the rows are
 * merged and re-sorted by decided_at descending — preserving the single-query
 * ordering the callers depend on across the chunk boundary.
 */
export async function getMatchDecisionsForSongs(
	accountId: string,
	songIds: string[],
): Promise<Result<MatchDecision[], DbError>> {
	if (songIds.length === 0) {
		return Result.ok<MatchDecision[], DbError>([]);
	}

	const supabase = createAdminSupabaseClient();
	const uniqueIds = [...new Set(songIds)];
	const merged = await chunkedRead(uniqueIds, (batch) =>
		fromSupabaseMany(
			supabase
				.from("match_decision")
				.select("*")
				.eq("account_id", accountId)
				.in("song_id", batch)
				.order("decided_at", { ascending: false }),
		),
	);
	if (Result.isError(merged)) return merged;

	const decisions = [...merged.value];
	// Re-establish the documented decided_at descending order after merging
	// per-chunk results. Array.sort is stable, so rows sharing a decided_at keep
	// their merge order rather than reshuffling nondeterministically.
	decisions.sort((a, b) =>
		a.decided_at < b.decided_at ? 1 : a.decided_at > b.decided_at ? -1 : 0,
	);

	return Result.ok<MatchDecision[], DbError>(decisions);
}

/**
 * Gets match decisions for a specific playlist belonging to an account.
 * Used by the playlist-orientation visible suggestion list derivation to
 * exclude already-decided (song, playlist) pairs from the suggestion set.
 * Returns empty array if none found.
 */
export function getMatchDecisionsForPlaylist(
	accountId: string,
	playlistId: string,
): Promise<Result<MatchDecision[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_decision")
			.select("*")
			.eq("account_id", accountId)
			.eq("playlist_id", playlistId)
			.order("decided_at", { ascending: false }),
	);
}

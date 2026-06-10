/**
 * Match context and result data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Tables } from "@/lib/data/database.types";
import type { DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
} from "@/lib/shared/utils/result-wrappers/supabase";

// ============================================================================
// Type Exports
// ============================================================================

/** Match snapshot row type */
type MatchSnapshot = Tables<"match_snapshot">;

/** Match result row type */
type MatchResult = Tables<"match_result">;

// ============================================================================
// Match Context Operations
// ============================================================================

/**
 * Gets the latest match snapshot for an account.
 * Returns null if none found.
 */
export function getLatestMatchSnapshot(
	accountId: string,
): Promise<Result<MatchSnapshot | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("match_snapshot")
			.select("*")
			.eq("account_id", accountId)
			.order("created_at", { ascending: false })
			.limit(1)
			.single(),
	);
}

// ============================================================================
// Match Result Operations
// ============================================================================

/**
 * Gets all match results for a snapshot.
 * Results are ordered by score descending, with song_id tiebreaker for determinism.
 */
export function getMatchResults(
	snapshotId: string,
): Promise<Result<MatchResult[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_result")
			.select("*")
			.eq("snapshot_id", snapshotId)
			.order("score", { ascending: false })
			.order("song_id", { ascending: true }),
	);
}

/**
 * Gets match results for a specific song in a snapshot.
 * Results are ordered by score descending.
 *
 * Selects only the columns callers consume — the full row drags the factors /
 * normalized_factors JSONB along for no reader.
 */
export function getMatchResultsForSong(
	snapshotId: string,
	songId: string,
): Promise<
	Result<
		Pick<MatchResult, "song_id" | "playlist_id" | "score" | "rank">[],
		DbError
	>
> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_result")
			.select("song_id, playlist_id, score, rank")
			.eq("snapshot_id", snapshotId)
			.eq("song_id", songId)
			.order("score", { ascending: false }),
	);
}

/**
 * Served ranks for a song in a snapshot, gated on the snapshot belonging to the
 * account — in one round trip: the match_snapshot row proves ownership, the
 * embedded match_result rows carry the ranks. Returns null when the snapshot
 * doesn't exist or is another account's; an empty array when it's owned but
 * never surfaced this song.
 */
export async function getServedRanksForSong(
	snapshotId: string,
	accountId: string,
	songId: string,
): Promise<
	Result<Pick<MatchResult, "playlist_id" | "rank">[] | null, DbError>
> {
	const supabase = createAdminSupabaseClient();
	const snapshot = await fromSupabaseMaybe(
		supabase
			.from("match_snapshot")
			.select("id, match_result(playlist_id, rank)")
			.eq("id", snapshotId)
			.eq("account_id", accountId)
			.eq("match_result.song_id", songId)
			.maybeSingle(),
	);
	if (Result.isError(snapshot)) {
		return Result.err(snapshot.error);
	}
	return Result.ok(snapshot.value?.match_result ?? null);
}

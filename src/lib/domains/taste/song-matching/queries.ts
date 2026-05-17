/**
 * Match context and result data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import type { Result } from "better-result";
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
 */
export function getMatchResultsForSong(
	snapshotId: string,
	songId: string,
): Promise<Result<MatchResult[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_result")
			.select("*")
			.eq("snapshot_id", snapshotId)
			.eq("song_id", songId)
			.order("score", { ascending: false }),
	);
}

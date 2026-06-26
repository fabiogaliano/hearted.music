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

/** Match result ranking row type */
type MatchResultRanking = Tables<"match_result_ranking">;

/**
 * Orientation-specific ranking data for a pair. Used by the visible
 * suggestion list derivation to sort suggestions by model rank.
 */
export type MatchRankingRow = Pick<
	MatchResultRanking,
	"song_id" | "playlist_id" | "rank" | "ordering_score"
>;

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

/**
 * Whether a specific snapshot belongs to an account — checked by id, not by "is
 * it the latest". A frozen match session keeps walking the snapshot it started
 * on even after a background refresh supersedes it, so per-song reads must
 * accept any snapshot the account owns (the same rule decision-logging already
 * follows via getServedRanksForSong). Returns false for a missing or foreign
 * snapshot.
 */
export async function isSnapshotOwnedByAccount(
	snapshotId: string,
	accountId: string,
): Promise<Result<boolean, DbError>> {
	const supabase = createAdminSupabaseClient();
	const snapshot = await fromSupabaseMaybe(
		supabase
			.from("match_snapshot")
			.select("id")
			.eq("id", snapshotId)
			.eq("account_id", accountId)
			.maybeSingle(),
	);
	if (Result.isError(snapshot)) {
		return Result.err(snapshot.error);
	}
	return Result.ok(snapshot.value !== null);
}

// ============================================================================
// Match Result Operations
// ============================================================================

/**
 * The columns the undecided-derivation reads — never the factors JSONB blobs.
 * fused_score is included so callers can use strictnessScore(row) (MSR-02)
 * instead of reading the legacy ordering score directly.
 */
export type MatchResultRow = Pick<
	MatchResult,
	"song_id" | "playlist_id" | "score" | "fused_score"
>;

/**
 * Gets all match results for a snapshot.
 * Ordered by score descending, with (song_id, playlist_id) tiebreakers so the
 * order is fully deterministic even when scores tie.
 *
 * Selects only the columns the undecided derivation consumes. `select("*")` drags
 * the per-row `factors` / `normalized_factors` JSONB along for no reader — at
 * thousands of rows per snapshot that JSONB is the bulk of the transfer.
 */
export function getMatchResults(
	snapshotId: string,
): Promise<Result<MatchResultRow[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_result")
			.select("song_id, playlist_id, score, fused_score")
			.eq("snapshot_id", snapshotId)
			.order("score", { ascending: false })
			.order("song_id", { ascending: true })
			.order("playlist_id", { ascending: true }),
	);
}

/**
 * Gets match results for a specific song in a snapshot.
 * Ordered by score descending, with a playlist_id tiebreaker for determinism.
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
			.order("score", { ascending: false })
			.order("playlist_id", { ascending: true }),
	);
}

/**
 * Per-playlist match details for a single song in a snapshot, including the
 * `factors` JSONB the detail view renders. Bounded to one song so the heavy
 * JSONB is fetched only for the row actually displayed — never the whole
 * snapshot. Ordered by score descending.
 */
export function getMatchResultDetailsForSong(
	snapshotId: string,
	songId: string,
): Promise<
	Result<
		Pick<MatchResult, "playlist_id" | "score" | "rank" | "factors">[],
		DbError
	>
> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_result")
			.select("playlist_id, score, rank, factors")
			.eq("snapshot_id", snapshotId)
			.eq("song_id", songId)
			.order("score", { ascending: false })
			.order("playlist_id", { ascending: true }),
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

// ============================================================================
// Visible Suggestion List Queries
// ============================================================================

/**
 * Match pairs for a single song — score + fused_score so callers can use
 * strictnessScore() (MSR-22). Does NOT include the factors JSONB.
 */
export type MatchPairRow = Pick<
	MatchResult,
	"song_id" | "playlist_id" | "score" | "fused_score"
>;

/**
 * Fetches all (song, playlist) pairs for a song subject in a snapshot.
 * Ordered by score desc with playlist_id tiebreaker for determinism.
 * This is the read path for song-orientation suggestion derivation.
 */
export function getMatchPairsForSong(
	snapshotId: string,
	songId: string,
): Promise<Result<MatchPairRow[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_result")
			.select("song_id, playlist_id, score, fused_score")
			.eq("snapshot_id", snapshotId)
			.eq("song_id", songId)
			.order("score", { ascending: false })
			.order("playlist_id", { ascending: true }),
	);
}

/**
 * Fetches all (song, playlist) pairs for a playlist subject in a snapshot.
 * Ordered by score desc with song_id tiebreaker for determinism.
 * This is the read path for playlist-orientation suggestion derivation.
 */
export function getMatchPairsForPlaylist(
	snapshotId: string,
	playlistId: string,
): Promise<Result<MatchPairRow[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_result")
			.select("song_id, playlist_id, score, fused_score")
			.eq("snapshot_id", snapshotId)
			.eq("playlist_id", playlistId)
			.order("score", { ascending: false })
			.order("song_id", { ascending: true }),
	);
}

/**
 * Fetches song-orientation ranking rows for a specific song in a snapshot.
 * Each row's `rank` is the model rank assigned by the ranking pipeline
 * (reranker or fused fallback) for the song's suggestion list.
 */
export function getMatchRankingsForSong(
	snapshotId: string,
	songId: string,
): Promise<Result<MatchRankingRow[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_result_ranking")
			.select("song_id, playlist_id, rank, ordering_score")
			.eq("snapshot_id", snapshotId)
			.eq("song_id", songId)
			.eq("orientation", "song")
			.order("rank", { ascending: true }),
	);
}

/**
 * Fetches playlist-orientation ranking rows for a specific playlist in a
 * snapshot. Each row's `rank` is the model rank assigned by the ranking
 * pipeline for the playlist's suggestion list.
 */
export function getMatchRankingsForPlaylist(
	snapshotId: string,
	playlistId: string,
): Promise<Result<MatchRankingRow[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_result_ranking")
			.select("song_id, playlist_id, rank, ordering_score")
			.eq("snapshot_id", snapshotId)
			.eq("playlist_id", playlistId)
			.eq("orientation", "playlist")
			.order("rank", { ascending: true }),
	);
}

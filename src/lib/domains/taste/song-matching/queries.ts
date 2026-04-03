/**
 * Match context and result data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json, Tables, TablesInsert } from "@/lib/data/database.types";

// ============================================================================
// Type Exports
// ============================================================================

/** Match snapshot row type */
export type MatchSnapshot = Tables<"match_snapshot">;

/** Match result row type */
export type MatchResult = Tables<"match_result">;

/** Insert type for match snapshot */
export type InsertMatchSnapshot = Pick<
	TablesInsert<"match_snapshot">,
	| "account_id"
	| "algorithm_version"
	| "analysis_model"
	| "analysis_version"
	| "embedding_model"
	| "embedding_version"
	| "weights"
	| "config_hash"
	| "playlist_set_hash"
	| "candidate_set_hash"
	| "snapshot_hash"
	| "playlist_count"
	| "song_count"
>;

/** Insert type for match result */
export type InsertMatchResult = Pick<
	TablesInsert<"match_result">,
	"snapshot_id" | "song_id" | "playlist_id" | "score" | "rank" | "factors"
>;

/** Aggregated top match result with song info */
export type TopMatch = {
	song_id: string;
	playlist_id: string;
	score: number;
	rank: number | null;
	factors: Json;
};

// ============================================================================
// Match Context Operations
// ============================================================================

/**
 * Gets a match snapshot by its ID.
 * Returns null if not found.
 */
export function getMatchSnapshot(
	snapshotId: string,
): Promise<Result<MatchSnapshot | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase.from("match_snapshot").select("*").eq("id", snapshotId).single(),
	);
}

/**
 * Gets a match snapshot by its snapshot hash.
 * Used for cache-first lookup before computing new matches.
 * Returns null if not found.
 */
export function getMatchSnapshotByHash(
	snapshotHash: string,
	accountId?: string,
): Promise<Result<MatchSnapshot | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	let query = supabase
		.from("match_snapshot")
		.select("*")
		.eq("snapshot_hash", snapshotHash);

	if (accountId) {
		query = query.eq("account_id", accountId);
	}

	return fromSupabaseMaybe(
		query.order("created_at", { ascending: false }).limit(1).single(),
	);
}

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
 * Gets all match snapshots for an account.
 * Returns empty array if none found.
 */
export function getMatchSnapshots(
	accountId: string,
): Promise<Result<MatchSnapshot[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_snapshot")
			.select("*")
			.eq("account_id", accountId)
			.order("created_at", { ascending: false }),
	);
}

/**
 * Creates a new match snapshot.
 * Each snapshot represents the matching algorithm's configuration
 * and the state of playlists/songs at match time.
 */
export function createMatchSnapshot(
	data: InsertMatchSnapshot,
): Promise<Result<MatchSnapshot, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("match_snapshot")
			.insert({
				account_id: data.account_id,
				algorithm_version: data.algorithm_version,
				analysis_model: data.analysis_model ?? null,
				analysis_version: data.analysis_version ?? null,
				embedding_model: data.embedding_model ?? null,
				embedding_version: data.embedding_version ?? null,
				weights: (data.weights as Json) ?? {},
				config_hash: data.config_hash,
				playlist_set_hash: data.playlist_set_hash,
				candidate_set_hash: data.candidate_set_hash,
				snapshot_hash: data.snapshot_hash,
				playlist_count: data.playlist_count ?? 0,
				song_count: data.song_count ?? 0,
			})
			.select()
			.single(),
	);
}

/**
 * Gets the playlist_set_hash from the latest match snapshot for an account.
 * Returns null if no snapshot exists.
 */
export async function getLatestPlaylistSetHash(
	accountId: string,
): Promise<Result<string | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMaybe(
		supabase
			.from("match_snapshot")
			.select("playlist_set_hash")
			.eq("account_id", accountId)
			.order("created_at", { ascending: false })
			.limit(1)
			.single(),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	return Result.ok(result.value?.playlist_set_hash ?? null);
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

/**
 * Gets match results for multiple songs in a snapshot.
 * Returns a map of songId -> array of results.
 */
export async function getMatchResultsForSongs(
	snapshotId: string,
	songIds: string[],
): Promise<Result<Map<string, MatchResult[]>, DbError>> {
	if (songIds.length === 0) {
		return Result.ok(new Map<string, MatchResult[]>());
	}

	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("match_result")
			.select("*")
			.eq("snapshot_id", snapshotId)
			.in("song_id", songIds)
			.order("score", { ascending: false }),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	// Group by song_id
	const resultsMap = new Map<string, MatchResult[]>();
	for (const matchResult of result.value) {
		const existing = resultsMap.get(matchResult.song_id) ?? [];
		existing.push(matchResult);
		resultsMap.set(matchResult.song_id, existing);
	}

	return Result.ok(resultsMap);
}

/**
 * Bulk inserts match results.
 * Returns all inserted results.
 */
export function insertMatchResults(
	results: InsertMatchResult[],
): Promise<Result<MatchResult[], DbError>> {
	if (results.length === 0) {
		return Promise.resolve(Result.ok<MatchResult[], DbError>([]));
	}

	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_result")
			.insert(
				results.map((r) => ({
					snapshot_id: r.snapshot_id,
					song_id: r.song_id,
					playlist_id: r.playlist_id,
					score: r.score,
					rank: r.rank ?? null,
					factors: (r.factors as Json) ?? {},
				})),
			)
			.select(),
	);
}

/**
 * Gets the top N matches per playlist in a snapshot.
 * Groups results by playlist and returns the highest-scoring songs.
 *
 * Note: This fetches all results and processes in memory.
 * For large datasets, consider a database function.
 */
export async function getTopMatchesPerPlaylist(
	snapshotId: string,
	limit: number = 10,
): Promise<Result<Map<string, TopMatch[]>, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("match_result")
			.select("song_id, playlist_id, score, rank, factors")
			.eq("snapshot_id", snapshotId)
			.order("score", { ascending: false }),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	// Group by playlist_id and take top N per playlist
	const playlistMatches = new Map<string, TopMatch[]>();

	for (const match of result.value) {
		const existing = playlistMatches.get(match.playlist_id) ?? [];
		if (existing.length < limit) {
			existing.push({
				song_id: match.song_id,
				playlist_id: match.playlist_id,
				score: match.score,
				rank: match.rank,
				factors: match.factors,
			});
			playlistMatches.set(match.playlist_id, existing);
		}
	}

	return Result.ok(playlistMatches);
}

/**
 * Gets the best match (highest score) for each song in a snapshot.
 * Useful for showing the recommended playlist for each song.
 */
export async function getBestMatchPerSong(
	snapshotId: string,
): Promise<Result<Map<string, MatchResult>, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("match_result")
			.select("*")
			.eq("snapshot_id", snapshotId)
			.order("score", { ascending: false }),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	// Keep only the best match per song (first occurrence due to ordering)
	const bestMatches = new Map<string, MatchResult>();
	for (const match of result.value) {
		if (!bestMatches.has(match.song_id)) {
			bestMatches.set(match.song_id, match);
		}
	}

	return Result.ok(bestMatches);
}

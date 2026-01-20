/**
 * Match context and result data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Json, Tables, TablesInsert } from "./database.types";

// ============================================================================
// Type Exports
// ============================================================================

/** Match context row type */
export type MatchContext = Tables<"match_context">;

/** Match result row type */
export type MatchResult = Tables<"match_result">;

/** Insert type for match context */
export type InsertMatchContext = Pick<
	TablesInsert<"match_context">,
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
	| "context_hash"
	| "playlist_count"
	| "song_count"
>;

/** Insert type for match result */
export type InsertMatchResult = Pick<
	TablesInsert<"match_result">,
	"context_id" | "song_id" | "playlist_id" | "score" | "rank" | "factors"
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
 * Gets a match context by its ID.
 * Returns null if not found.
 */
export function getMatchContext(
	contextId: string,
): Promise<Result<MatchContext | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase.from("match_context").select("*").eq("id", contextId).single(),
	);
}

/**
 * Gets the latest match context for an account.
 * Returns null if none found.
 */
export function getLatestMatchContext(
	accountId: string,
): Promise<Result<MatchContext | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("match_context")
			.select("*")
			.eq("account_id", accountId)
			.order("created_at", { ascending: false })
			.limit(1)
			.single(),
	);
}

/**
 * Gets all match contexts for an account.
 * Returns empty array if none found.
 */
export function getMatchContexts(
	accountId: string,
): Promise<Result<MatchContext[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_context")
			.select("*")
			.eq("account_id", accountId)
			.order("created_at", { ascending: false }),
	);
}

/**
 * Creates a new match context.
 * Each context represents a snapshot of the matching algorithm's configuration
 * and the state of playlists/songs at match time.
 */
export function createMatchContext(
	data: InsertMatchContext,
): Promise<Result<MatchContext, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("match_context")
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
				context_hash: data.context_hash,
				playlist_count: data.playlist_count ?? 0,
				song_count: data.song_count ?? 0,
			})
			.select()
			.single(),
	);
}

// ============================================================================
// Match Result Operations
// ============================================================================

/**
 * Gets all match results for a context.
 * Results are ordered by score descending.
 */
export function getMatchResults(
	contextId: string,
): Promise<Result<MatchResult[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_result")
			.select("*")
			.eq("context_id", contextId)
			.order("score", { ascending: false }),
	);
}

/**
 * Gets match results for a specific song in a context.
 * Results are ordered by score descending.
 */
export function getMatchResultsForSong(
	contextId: string,
	songId: string,
): Promise<Result<MatchResult[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_result")
			.select("*")
			.eq("context_id", contextId)
			.eq("song_id", songId)
			.order("score", { ascending: false }),
	);
}

/**
 * Gets match results for multiple songs in a context.
 * Returns a map of songId -> array of results.
 */
export async function getMatchResultsForSongs(
	contextId: string,
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
			.eq("context_id", contextId)
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
					context_id: r.context_id,
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
 * Gets the top N matches per playlist in a context.
 * Groups results by playlist and returns the highest-scoring songs.
 *
 * Note: This fetches all results and processes in memory.
 * For large datasets, consider a database function.
 */
export async function getTopMatchesPerPlaylist(
	contextId: string,
	limit: number = 10,
): Promise<Result<Map<string, TopMatch[]>, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("match_result")
			.select("song_id, playlist_id, score, rank, factors")
			.eq("context_id", contextId)
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
 * Gets the best match (highest score) for each song in a context.
 * Useful for showing the recommended playlist for each song.
 */
export async function getBestMatchPerSong(
	contextId: string,
): Promise<Result<Map<string, MatchResult>, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("match_result")
			.select("*")
			.eq("context_id", contextId)
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

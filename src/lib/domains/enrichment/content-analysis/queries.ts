/**
 * Song analysis data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json, Tables, TablesInsert } from "@/lib/data/database.types";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { chunkedRead } from "@/lib/shared/utils/chunked-read";
import {
	fromSupabaseMany,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";

// ============================================================================
// Type Exports
// ============================================================================

/** Song analysis row type */
export type SongAnalysis = Tables<"song_analysis">;

/** Insert type for song analysis */
export type InsertData = Pick<
	TablesInsert<"song_analysis">,
	| "song_id"
	| "analysis"
	| "model"
	| "prompt_version"
	| "tokens_used"
	| "cost_cents"
	| "cleanup_passes"
	| "cleanup_tells_before"
	| "cleanup_tells_after"
	| "cleanup_error"
>;

// ============================================================================
// Query Operations
// ============================================================================

/**
 * Gets the latest song analysis for a single song.
 * Returns null if not found.
 */
export async function get(
	songId: string,
): Promise<Result<SongAnalysis | null, DbError>>;
/**
 * Gets the latest song analysis for multiple songs.
 * Returns a map of songId -> analysis.
 */
export async function get(
	songIds: string[],
): Promise<Result<Map<string, SongAnalysis>, DbError>>;
export async function get(
	songIds: string | string[],
): Promise<Result<SongAnalysis | null | Map<string, SongAnalysis>, DbError>> {
	const isSingle = typeof songIds === "string";
	const ids = isSingle ? [songIds] : [...new Set(songIds)];

	if (!isSingle && ids.length === 0) {
		return Result.ok(new Map<string, SongAnalysis>());
	}

	const supabase = createAdminSupabaseClient();

	// Get all analyses for the songs, ordered by created_at desc to get latest
	// first. Uncapped batch callers (snapshot refresh stored-pair songs) can pass
	// song-sized id lists, so the `.in("song_id", …)` filter is chunked
	// (DB_IN_FILTER_CHUNK_SIZE) to keep each request under the PostgREST
	// URI-length limit. Each song_id lands in exactly one chunk and the per-chunk
	// query keeps the created_at DESC order, so the latest-per-song first-occurrence
	// dedup below is preserved when the chunk rows are merged.
	const result = await chunkedRead(ids, (batch) =>
		fromSupabaseMany(
			supabase
				.from("song_analysis")
				.select("*")
				.in("song_id", batch)
				.order("created_at", { ascending: false }),
		),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	// For batch: build map with only the latest analysis per song
	const analysisMap = new Map<string, SongAnalysis>();
	for (const analysis of result.value) {
		if (!analysisMap.has(analysis.song_id)) {
			analysisMap.set(analysis.song_id, analysis);
		}
	}

	if (isSingle) {
		return Result.ok(analysisMap.get(songIds as string) ?? null);
	}

	return Result.ok(analysisMap);
}

// ============================================================================
// Mutation Operations
// ============================================================================

/**
 * Upserts a song analysis record, keyed on (song_id, model, prompt_version).
 * A re-run with the same model + prompt overwrites in place; a model or prompt
 * change creates a new row (cross-version history is preserved).
 *
 * Routed through the upsert_song_analysis RPC rather than supabase-js .upsert()
 * because the conflict UPDATE must bump created_at to the server clock — the
 * enrichment selector compares latest_analysis.created_at against lyrics/embedding
 * timestamps to terminate the reanalyze and re-embed loops, and supabase-js cannot
 * express now() in an upsert. See migration 20260623170000_song_analysis_upsert.
 */
export function upsert(
	data: InsertData,
): Promise<Result<SongAnalysis, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.rpc("upsert_song_analysis", {
				p_song_id: data.song_id,
				p_analysis: data.analysis as Json,
				p_model: data.model,
				p_prompt_version: data.prompt_version ?? undefined,
				p_tokens_used: data.tokens_used ?? undefined,
				p_cost_cents: data.cost_cents ?? undefined,
				p_cleanup_passes: data.cleanup_passes ?? undefined,
				p_cleanup_tells_before: data.cleanup_tells_before ?? undefined,
				p_cleanup_tells_after: data.cleanup_tells_after ?? undefined,
				p_cleanup_error: data.cleanup_error ?? undefined,
			})
			.single(),
	);
}

/**
 * Counts how many of a user's liked songs have analysis records.
 * Used for "X% analyzed" stat on dashboard.
 *
 * Uses RPC function to perform the count in a single query with JOIN,
 * avoiding large IN clauses for users with many liked songs.
 */
export async function getAnalyzedCountForAccount(
	accountId: string,
): Promise<Result<number, DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"count_analyzed_songs_for_account",
		{
			p_account_id: accountId,
		},
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(data ?? 0);
}

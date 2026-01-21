/**
 * Song analysis data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Json, Tables, TablesInsert } from "./database.types";

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
	const supabase = createAdminSupabaseClient();
	const isSingle = typeof songIds === "string";
	const ids = isSingle ? [songIds] : songIds;

	if (ids.length === 0) {
		return Result.ok(new Map<string, SongAnalysis>());
	}

	// Get all analyses for the songs, ordered by created_at desc to get latest first
	const result = await fromSupabaseMany(
		supabase
			.from("song_analysis")
			.select("*")
			.in("song_id", ids)
			.order("created_at", { ascending: false }),
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
 * Inserts a new song analysis record.
 * Multiple analyses can exist per song (different models/versions).
 */
export function insert(
	data: InsertData,
): Promise<Result<SongAnalysis, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("song_analysis")
			.insert({
				song_id: data.song_id,
				analysis: data.analysis as Json,
				model: data.model,
				prompt_version: data.prompt_version ?? null,
				tokens_used: data.tokens_used ?? null,
				cost_cents: data.cost_cents ?? null,
			})
			.select()
			.single(),
	);
}

/**
 * Playlist analysis data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/errors/data";
import {
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Json, Tables, TablesInsert } from "./database.types";

// ============================================================================
// Type Exports
// ============================================================================

/** Playlist analysis row type */
export type PlaylistAnalysis = Tables<"playlist_analysis">;

/** Insert type for playlist analysis */
export type InsertData = Pick<
	TablesInsert<"playlist_analysis">,
	| "playlist_id"
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
 * Gets the latest playlist analysis.
 * Returns null if not found.
 */
export async function get(
	playlistId: string,
): Promise<Result<PlaylistAnalysis | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("playlist_analysis")
			.select("*")
			.eq("playlist_id", playlistId)
			.order("created_at", { ascending: false })
			.limit(1)
			.single(),
	);
}

// ============================================================================
// Mutation Operations
// ============================================================================

/**
 * Inserts a new playlist analysis record.
 * Multiple analyses can exist per playlist (different models/versions).
 */
export function insert(
	data: InsertData,
): Promise<Result<PlaylistAnalysis, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("playlist_analysis")
			.insert({
				playlist_id: data.playlist_id,
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

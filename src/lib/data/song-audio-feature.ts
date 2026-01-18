/**
 * Song audio feature data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/errors/data";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
} from "@/lib/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Tables, TablesInsert } from "./database.types";

// ============================================================================
// Type Exports
// ============================================================================

/** Song audio feature row type */
export type AudioFeature = Tables<"song_audio_feature">;

/** Insert type for song audio features */
export type UpsertData = Pick<
	TablesInsert<"song_audio_feature">,
	| "song_id"
	| "acousticness"
	| "danceability"
	| "energy"
	| "instrumentalness"
	| "key"
	| "liveness"
	| "loudness"
	| "mode"
	| "speechiness"
	| "tempo"
	| "time_signature"
	| "valence"
>;

// ============================================================================
// Query Operations
// ============================================================================

/**
 * Gets audio features for a song.
 * Returns null if not found.
 */
export function get(
	songId: string,
): Promise<Result<AudioFeature | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("song_audio_feature")
			.select("*")
			.eq("song_id", songId)
			.single(),
	);
}

/**
 * Gets audio features for multiple songs.
 * Returns a map of songId -> features.
 */
export async function getBatch(
	songIds: string[],
): Promise<Result<Map<string, AudioFeature>, DbError>> {
	if (songIds.length === 0) {
		return Result.ok(new Map<string, AudioFeature>());
	}

	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase.from("song_audio_feature").select("*").in("song_id", songIds),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	const featureMap = new Map<string, AudioFeature>();
	for (const feature of result.value) {
		featureMap.set(feature.song_id, feature);
	}

	return Result.ok(featureMap);
}

// ============================================================================
// Mutation Operations
// ============================================================================

/**
 * Upserts audio features for songs.
 * Uses song_id as the conflict target (one-to-one relationship).
 */
export function upsert(
	features: UpsertData[],
): Promise<Result<AudioFeature[], DbError>> {
	if (features.length === 0) {
		return Promise.resolve(Result.ok<AudioFeature[], DbError>([]));
	}

	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("song_audio_feature")
			.upsert(
				features.map((f) => ({
					song_id: f.song_id,
					acousticness: f.acousticness ?? null,
					danceability: f.danceability ?? null,
					energy: f.energy ?? null,
					instrumentalness: f.instrumentalness ?? null,
					key: f.key ?? null,
					liveness: f.liveness ?? null,
					loudness: f.loudness ?? null,
					mode: f.mode ?? null,
					speechiness: f.speechiness ?? null,
					tempo: f.tempo ?? null,
					time_signature: f.time_signature ?? null,
					valence: f.valence ?? null,
				})),
				{ onConflict: "song_id" },
			)
			.select(),
	);
}

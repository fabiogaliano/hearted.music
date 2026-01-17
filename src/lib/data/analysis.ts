/**
 * Song and playlist LLM analysis data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/errors/data";
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

/** Song analysis row type */
export type SongAnalysis = Tables<"song_analysis">;

/** Song audio feature row type */
export type SongAudioFeature = Tables<"song_audio_feature">;

/** Playlist analysis row type */
export type PlaylistAnalysis = Tables<"playlist_analysis">;

/** Insert type for song analysis */
export type InsertSongAnalysis = Pick<
	TablesInsert<"song_analysis">,
	| "song_id"
	| "analysis"
	| "model_name"
	| "model_version"
	| "prompt_tokens"
	| "completion_tokens"
>;

/** Insert type for song audio features */
export type UpsertSongAudioFeature = Pick<
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

/** Insert type for playlist analysis */
export type InsertPlaylistAnalysis = Pick<
	TablesInsert<"playlist_analysis">,
	| "playlist_id"
	| "analysis"
	| "model_name"
	| "model_version"
	| "prompt_tokens"
	| "completion_tokens"
>;

// ============================================================================
// Song Analysis Operations
// ============================================================================

/**
 * Gets the latest song analysis for one or more songs.
 * Returns a map of songId -> analysis for batch queries.
 * Returns null for single song if not found.
 */
export async function getSongAnalysis(
	songIds: string | string[],
): Promise<Result<SongAnalysis | null, DbError>>;
export async function getSongAnalysis(
	songIds: string[],
): Promise<Result<Map<string, SongAnalysis>, DbError>>;
export async function getSongAnalysis(
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

/**
 * Inserts a new song analysis record.
 * Multiple analyses can exist per song (different models/versions).
 */
export function insertSongAnalysis(
	data: InsertSongAnalysis,
): Promise<Result<SongAnalysis, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("song_analysis")
			.insert({
				song_id: data.song_id,
				analysis: data.analysis as Json,
				model_name: data.model_name,
				model_version: data.model_version ?? null,
				prompt_tokens: data.prompt_tokens ?? null,
				completion_tokens: data.completion_tokens ?? null,
			})
			.select()
			.single(),
	);
}

// ============================================================================
// Song Audio Feature Operations
// ============================================================================

/**
 * Gets audio features for a song.
 * Returns null if not found.
 */
export function getSongAudioFeatures(
	songId: string,
): Promise<Result<SongAudioFeature | null, DbError>> {
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
export async function getSongAudioFeaturesBatch(
	songIds: string[],
): Promise<Result<Map<string, SongAudioFeature>, DbError>> {
	if (songIds.length === 0) {
		return Result.ok(new Map<string, SongAudioFeature>());
	}

	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase.from("song_audio_feature").select("*").in("song_id", songIds),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	const featureMap = new Map<string, SongAudioFeature>();
	for (const feature of result.value) {
		featureMap.set(feature.song_id, feature);
	}

	return Result.ok(featureMap);
}

/**
 * Upserts audio features for songs.
 * Uses song_id as the conflict target (one-to-one relationship).
 */
export function upsertSongAudioFeatures(
	features: UpsertSongAudioFeature[],
): Promise<Result<SongAudioFeature[], DbError>> {
	if (features.length === 0) {
		return Promise.resolve(Result.ok<SongAudioFeature[], DbError>([]));
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

// ============================================================================
// Playlist Analysis Operations
// ============================================================================

/**
 * Gets the latest playlist analysis.
 * Returns null if not found.
 */
export async function getPlaylistAnalysis(
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

/**
 * Inserts a new playlist analysis record.
 * Multiple analyses can exist per playlist (different models/versions).
 */
export function insertPlaylistAnalysis(
	data: InsertPlaylistAnalysis,
): Promise<Result<PlaylistAnalysis, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("playlist_analysis")
			.insert({
				playlist_id: data.playlist_id,
				analysis: data.analysis as Json,
				model_name: data.model_name,
				model_version: data.model_version ?? null,
				prompt_tokens: data.prompt_tokens ?? null,
				completion_tokens: data.completion_tokens ?? null,
			})
			.select()
			.single(),
	);
}

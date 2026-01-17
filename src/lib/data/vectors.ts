/**
 * Embedding and profile vector data operations.
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

/** Song embedding row type */
export type SongEmbedding = Tables<"song_embedding">;

/** Playlist profile row type */
export type PlaylistProfile = Tables<"playlist_profile">;

/** Insert type for song embedding */
export type UpsertSongEmbedding = Pick<
	TablesInsert<"song_embedding">,
	| "song_id"
	| "embedding"
	| "kind"
	| "model"
	| "model_version"
	| "dims"
	| "content_hash"
>;

/** Insert type for playlist profile */
export type UpsertPlaylistProfile = Pick<
	TablesInsert<"playlist_profile">,
	| "playlist_id"
	| "kind"
	| "model_bundle_hash"
	| "dims"
	| "content_hash"
	| "embedding"
	| "audio_centroid"
	| "genre_distribution"
	| "emotion_distribution"
	| "song_count"
	| "song_ids"
>;

// ============================================================================
// Song Embedding Operations
// ============================================================================

/**
 * Gets the embedding for a song by model name.
 * Returns null if not found.
 *
 * @param songId - The song UUID
 * @param model - The embedding model name (e.g., "text-embedding-3-small")
 */
export function getSongEmbedding(
	songId: string,
	model: string,
): Promise<Result<SongEmbedding | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("song_embedding")
			.select("*")
			.eq("song_id", songId)
			.eq("model", model)
			.single(),
	);
}

/**
 * Gets all embeddings for a song (across different models).
 */
export function getSongEmbeddings(
	songId: string,
): Promise<Result<SongEmbedding[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("song_embedding")
			.select("*")
			.eq("song_id", songId)
			.order("created_at", { ascending: false }),
	);
}

/**
 * Gets embeddings for multiple songs by model name.
 * Returns a map of songId -> embedding.
 */
export async function getSongEmbeddingsBatch(
	songIds: string[],
	model: string,
): Promise<Result<Map<string, SongEmbedding>, DbError>> {
	if (songIds.length === 0) {
		return Result.ok(new Map<string, SongEmbedding>());
	}

	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("song_embedding")
			.select("*")
			.in("song_id", songIds)
			.eq("model", model),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	const embeddingMap = new Map<string, SongEmbedding>();
	for (const embedding of result.value) {
		embeddingMap.set(embedding.song_id, embedding);
	}

	return Result.ok(embeddingMap);
}

/**
 * Upserts a song embedding.
 * Uses (song_id, kind, model, model_version, content_hash) as the conflict target.
 */
export function upsertSongEmbedding(
	data: UpsertSongEmbedding,
): Promise<Result<SongEmbedding, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("song_embedding")
			.upsert(
				{
					song_id: data.song_id,
					kind: data.kind,
					model: data.model,
					model_version: data.model_version ?? null,
					dims: data.dims,
					content_hash: data.content_hash,
					embedding: data.embedding,
				},
				{ onConflict: "song_id,kind,model,model_version,content_hash" },
			)
			.select()
			.single(),
	);
}

/**
 * Bulk upserts song embeddings.
 * Uses (song_id, kind, model, model_version, content_hash) as the conflict target.
 */
export function upsertSongEmbeddings(
	embeddings: UpsertSongEmbedding[],
): Promise<Result<SongEmbedding[], DbError>> {
	if (embeddings.length === 0) {
		return Promise.resolve(Result.ok<SongEmbedding[], DbError>([]));
	}

	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("song_embedding")
			.upsert(
				embeddings.map((e) => ({
					song_id: e.song_id,
					kind: e.kind,
					model: e.model,
					model_version: e.model_version ?? null,
					dims: e.dims,
					content_hash: e.content_hash,
					embedding: e.embedding,
				})),
				{ onConflict: "song_id,kind,model,model_version,content_hash" },
			)
			.select(),
	);
}

// ============================================================================
// Playlist Profile Operations
// ============================================================================

/**
 * Gets the profile for a playlist.
 * Returns null if not found.
 * Playlist profiles are one-to-one (unique on playlist_id).
 */
export function getPlaylistProfile(
	playlistId: string,
): Promise<Result<PlaylistProfile | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("playlist_profile")
			.select("*")
			.eq("playlist_id", playlistId)
			.single(),
	);
}

/**
 * Gets profiles for multiple playlists.
 * Returns a map of playlistId -> profile.
 */
export async function getPlaylistProfilesBatch(
	playlistIds: string[],
): Promise<Result<Map<string, PlaylistProfile>, DbError>> {
	if (playlistIds.length === 0) {
		return Result.ok(new Map<string, PlaylistProfile>());
	}

	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase.from("playlist_profile").select("*").in("playlist_id", playlistIds),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	const profileMap = new Map<string, PlaylistProfile>();
	for (const profile of result.value) {
		profileMap.set(profile.playlist_id, profile);
	}

	return Result.ok(profileMap);
}

/**
 * Upserts a playlist profile.
 * Uses (playlist_id, kind, model_bundle_hash, content_hash) as the conflict target.
 */
export function upsertPlaylistProfile(
	data: UpsertPlaylistProfile,
): Promise<Result<PlaylistProfile, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("playlist_profile")
			.upsert(
				{
					playlist_id: data.playlist_id,
					kind: data.kind,
					model_bundle_hash: data.model_bundle_hash,
					dims: data.dims,
					content_hash: data.content_hash,
					embedding: data.embedding ?? null,
					audio_centroid: (data.audio_centroid as Json) ?? null,
					genre_distribution: (data.genre_distribution as Json) ?? null,
					emotion_distribution: (data.emotion_distribution as Json) ?? null,
					song_count: data.song_count ?? 0,
					song_ids: data.song_ids ?? null,
				},
				{ onConflict: "playlist_id,kind,model_bundle_hash,content_hash" },
			)
			.select()
			.single(),
	);
}

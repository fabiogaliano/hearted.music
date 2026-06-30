/**
 * Embedding and profile vector data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json, Tables, TablesInsert } from "@/lib/data/database.types";
import type { DbError } from "@/lib/shared/errors/database";
import { chunkedRead } from "@/lib/shared/utils/chunked-read";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";

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
	| "song_count"
	| "song_ids"
>;

// ============================================================================
// Song Embedding Operations
// ============================================================================

/**
 * Gets the embedding for a song by model name and kind.
 * Returns null if not found.
 *
 * Returns the most recent embedding (by created_at) to handle model version changes.
 * When model_version changes, multiple rows may exist - we want the latest one.
 *
 * @param songId - The song UUID
 * @param model - The embedding model name (e.g., "text-embedding-3-small")
 * @param kind - The embedding kind (full, theme, mood, context)
 */
export function getSongEmbedding(
	songId: string,
	model: string,
	kind: SongEmbedding["kind"],
): Promise<Result<SongEmbedding | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("song_embedding")
			.select("*")
			.eq("song_id", songId)
			.eq("model", model)
			.eq("kind", kind)
			.order("created_at", { ascending: false })
			.limit(1)
			.maybeSingle(),
	);
}

/**
 * Gets embeddings for multiple songs by model name and kind.
 * Returns a map of songId -> embedding.
 *
 * Returns the most recent embedding (by created_at) for each song to handle model version changes.
 * When model_version changes, multiple rows may exist per song - we want the latest one per song.
 *
 * Uncapped callers (snapshot refresh, playlist profiling) can pass song-sized id
 * lists, so the `.in("song_id", …)` filter is chunked (DB_IN_FILTER_CHUNK_SIZE)
 * to keep each request's query string under the PostgREST URI-length limit. Each
 * song_id lands in exactly one chunk and the per-chunk query keeps the created_at
 * DESC order, so the latest-per-song first-occurrence dedup is preserved when the
 * chunk rows are merged into one map.
 */
export async function getSongEmbeddingsBatch(
	songIds: string[],
	model: string,
	kind: SongEmbedding["kind"],
): Promise<Result<Map<string, SongEmbedding>, DbError>> {
	if (songIds.length === 0) {
		return Result.ok(new Map<string, SongEmbedding>());
	}

	const supabase = createAdminSupabaseClient();
	const uniqueSongIds = [...new Set(songIds)];
	const result = await chunkedRead(uniqueSongIds, (batch) =>
		fromSupabaseMany(
			supabase
				.from("song_embedding")
				.select("*")
				.in("song_id", batch)
				.eq("model", model)
				.eq("kind", kind)
				.order("created_at", { ascending: false }),
		),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	// Keep only the latest embedding per song (first occurrence after ordering by created_at DESC)
	const embeddingMap = new Map<string, SongEmbedding>();
	for (const embedding of result.value) {
		if (!embeddingMap.has(embedding.song_id)) {
			embeddingMap.set(embedding.song_id, embedding);
		}
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
 * Multiple historical rows can exist per playlist, so this returns the latest.
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
			.order("updated_at", { ascending: false })
			.limit(1)
			.maybeSingle(),
	);
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
					song_count: data.song_count ?? 0,
					song_ids: data.song_ids ?? null,
				},
				{ onConflict: "playlist_id,kind,model_bundle_hash,content_hash" },
			)
			.select()
			.single(),
	);
}

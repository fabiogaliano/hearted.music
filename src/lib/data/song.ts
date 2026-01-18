/**
 * Song data operations.
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

/** Song row type */
export type Song = Tables<"song">;

/** Insert type for upserting songs */
export type UpsertData = Pick<
	TablesInsert<"song">,
	| "spotify_id"
	| "name"
	| "album_id"
	| "album_name"
	| "image_url"
	| "isrc"
	| "artists"
	| "duration_ms"
	| "genres"
	| "popularity"
	| "preview_url"
>;

// ============================================================================
// Query Operations
// ============================================================================

/**
 * Gets a song by its UUID.
 * Returns null if not found (not an error).
 */
export function getById(id: string): Promise<Result<Song | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase.from("song").select("*").eq("id", id).single(),
	);
}

/**
 * Gets a song by Spotify track ID.
 * Returns null if not found (not an error).
 */
export function getBySpotifyId(
	spotifyId: string,
): Promise<Result<Song | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase.from("song").select("*").eq("spotify_id", spotifyId).single(),
	);
}

/**
 * Gets multiple songs by their Spotify IDs.
 * Returns empty array if none found.
 */
export function getBySpotifyIds(
	spotifyIds: string[],
): Promise<Result<Song[], DbError>> {
	if (spotifyIds.length === 0) {
		return Promise.resolve(Result.ok<Song[], DbError>([]));
	}
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase.from("song").select("*").in("spotify_id", spotifyIds),
	);
}

/**
 * Gets multiple songs by their UUIDs.
 * Returns empty array if none found.
 */
export function getByIds(ids: string[]): Promise<Result<Song[], DbError>> {
	if (ids.length === 0) {
		return Promise.resolve(Result.ok<Song[], DbError>([]));
	}
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(supabase.from("song").select("*").in("id", ids));
}

// ============================================================================
// Mutation Operations
// ============================================================================

/**
 * Creates or updates songs based on Spotify ID.
 * Returns all upserted songs.
 */
export function upsert(data: UpsertData[]): Promise<Result<Song[], DbError>> {
	if (data.length === 0) {
		return Promise.resolve(Result.ok<Song[], DbError>([]));
	}
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("song")
			.upsert(
				data.map((song) => ({
					spotify_id: song.spotify_id,
					name: song.name,
					album_id: song.album_id,
					album_name: song.album_name,
					image_url: song.image_url,
					isrc: song.isrc ?? null,
					artists: song.artists,
					duration_ms: song.duration_ms,
					genres: song.genres ?? [],
					popularity: song.popularity,
					preview_url: song.preview_url,
				})),
				{ onConflict: "spotify_id" },
			)
			.select(),
	);
}

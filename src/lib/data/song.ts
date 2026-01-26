/**
 * Song data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
} from "@/lib/shared/utils/result-wrappers/supabase";
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
 * Batches queries to avoid "URI too long" errors (Supabase encodes .in() in URL).
 */
export async function getByIds(ids: string[]): Promise<Result<Song[], DbError>> {
	if (ids.length === 0) {
		return Result.ok([]);
	}

	const supabase = createAdminSupabaseClient();
	const BATCH_SIZE = 100; // Safe limit for URL length
	const allSongs: Song[] = [];

	// Process in batches to avoid URI length limits
	for (let i = 0; i < ids.length; i += BATCH_SIZE) {
		const batch = ids.slice(i, i + BATCH_SIZE);
		const result = await fromSupabaseMany(
			supabase.from("song").select("*").in("id", batch),
		);

		if (Result.isError(result)) {
			return result;
		}

		allSongs.push(...result.value);
	}

	return Result.ok(allSongs);
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
					isrc: song.isrc,
					artists: song.artists,
					duration_ms: song.duration_ms,
					genres: song.genres,
					popularity: song.popularity,
					preview_url: song.preview_url,
				})),
				{ onConflict: "spotify_id" },
			)
			.select(),
	);
}

// ============================================================================
// Genre Operations
// ============================================================================

/**
 * Updates genres for a song.
 * Genres should be lowercase and max 3 elements.
 */
export async function updateGenres(
	songId: string,
	genres: string[],
): Promise<Result<void, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMaybe(
		supabase
			.from("song")
			.update({ genres: genres.slice(0, 3) })
			.eq("id", songId)
			.select("id")
			.single(),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	return Result.ok(undefined);
}

/**
 * Gets songs that don't have genres set yet.
 * Used for backfill operations.
 */
export function getSongsWithoutGenres(
	accountId: string,
	limit = 100,
): Promise<Result<Song[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("song")
			.select("*, account_song!inner(account_id)")
			.eq("account_song.account_id", accountId)
			.or("genres.is.null,genres.eq.{}")
			.limit(limit),
	);
}

/**
 * Batch update genres for multiple songs.
 * More efficient than individual updates.
 */
export async function updateGenresBatch(
	updates: Array<{ songId: string; genres: string[] }>,
): Promise<Result<void, DbError>> {
	if (updates.length === 0) {
		return Result.ok(undefined);
	}

	const supabase = createAdminSupabaseClient();

	// Supabase doesn't support batch updates with different values per row,
	// so we use Promise.all with individual updates (still more efficient than N+1 pattern)
	const results = await Promise.all(
		updates.map(({ songId, genres }) =>
			fromSupabaseMaybe(
				supabase
					.from("song")
					.update({ genres: genres.slice(0, 3) })
					.eq("id", songId)
					.select("id")
					.single(),
			),
		),
	);

	// Check for any errors
	for (const result of results) {
		if (Result.isError(result)) {
			return Result.err(result.error);
		}
	}

	return Result.ok(undefined);
}

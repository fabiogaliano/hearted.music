/**
 * Song data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Tables, TablesInsert } from "@/lib/data/database.types";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { chunkedWrite } from "@/lib/shared/utils/chunked-write";
import { chunkArray, mapWithConcurrency } from "@/lib/shared/utils/concurrency";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
} from "@/lib/shared/utils/result-wrappers/supabase";

/** Song row type */
export type Song = Tables<"song">;

/** Insert type for upserting songs (includes all fields) */
export type UpsertData = Pick<
	TablesInsert<"song">,
	| "spotify_id"
	| "name"
	| "album_id"
	| "album_name"
	| "image_url"
	| "artists"
	| "artist_ids"
	| "duration_ms"
	| "genres"
>;

/** Catalog-only upsert: sync owns these fields, enrichment owns genres */
export type CatalogUpsertData = Pick<
	TablesInsert<"song">,
	| "spotify_id"
	| "name"
	| "album_id"
	| "album_name"
	| "image_url"
	| "artists"
	| "artist_ids"
	| "duration_ms"
	| "release_year"
	| "release_year_checked_at"
>;

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
export async function getByIds(
	ids: string[],
): Promise<Result<Song[], DbError>> {
	if (ids.length === 0) {
		return Result.ok([]);
	}

	const supabase = createAdminSupabaseClient();
	const BATCH_SIZE = 100; // Safe limit for URL length
	const BATCH_CONCURRENCY = 4;
	const batches = chunkArray(ids, BATCH_SIZE);

	const batchResults = await mapWithConcurrency(
		batches,
		BATCH_CONCURRENCY,
		(batch) =>
			fromSupabaseMany(supabase.from("song").select("*").in("id", batch)),
	);

	const allSongs: Song[] = [];
	for (const result of batchResults) {
		if (Result.isError(result)) {
			return result;
		}

		allSongs.push(...result.value);
	}

	return Result.ok(allSongs);
}

/**
 * Creates or updates songs based on Spotify ID.
 * Returns all upserted songs.
 */
export function upsert(data: UpsertData[]): Promise<Result<Song[], DbError>> {
	if (data.length === 0) {
		return Promise.resolve(Result.ok<Song[], DbError>([]));
	}
	const supabase = createAdminSupabaseClient();
	return chunkedWrite(data, (chunk) =>
		fromSupabaseMany(
			supabase
				.from("song")
				.upsert(
					chunk.map((song) => ({
						spotify_id: song.spotify_id,
						name: song.name,
						album_id: song.album_id,
						album_name: song.album_name,
						image_url: song.image_url,
						artists: song.artists,
						duration_ms: song.duration_ms,
						genres: song.genres,
					})),
					{ onConflict: "spotify_id" },
				)
				.select(),
		),
	);
}

/**
 * Creates or updates songs with catalog metadata only.
 * Never touches enrichment-owned fields (genres, etc.).
 * Use this from sync flows; use updateGenres/updateGenresBatch for enrichment.
 */
export function upsertCatalog(
	data: CatalogUpsertData[],
): Promise<Result<Song[], DbError>> {
	if (data.length === 0) {
		return Promise.resolve(Result.ok<Song[], DbError>([]));
	}
	const supabase = createAdminSupabaseClient();
	return chunkedWrite(data, (chunk) =>
		fromSupabaseMany(
			supabase
				.from("song")
				.upsert(
					chunk.map((song) => ({
						spotify_id: song.spotify_id,
						name: song.name,
						album_id: song.album_id,
						album_name: song.album_name,
						image_url: song.image_url,
						artists: song.artists,
						artist_ids: song.artist_ids,
						duration_ms: song.duration_ms,
						release_year: song.release_year,
						...(song.release_year_checked_at != null
							? { release_year_checked_at: song.release_year_checked_at }
							: {}),
					})),
					{ onConflict: "spotify_id" },
				)
				.select(),
		),
	);
}

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

	const UPDATE_CONCURRENCY = 5;
	const results = await mapWithConcurrency(
		updates,
		UPDATE_CONCURRENCY,
		({ songId, genres }) =>
			fromSupabaseMaybe(
				supabase
					.from("song")
					.update({ genres: genres.slice(0, 3) })
					.eq("id", songId)
					.select("id")
					.single(),
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

/**
 * Recomputes song.vocal_gender for the given songs via the
 * refresh_song_vocal_gender_for RPC (scoped, so Phase-1 doesn't full-scan the
 * catalog). Returns the number of songs whose vocal_gender actually changed.
 */
export async function refreshVocalGenderForSongs(
	songIds: string[],
): Promise<Result<number, DbError>> {
	if (songIds.length === 0) return Result.ok(0);

	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc("refresh_song_vocal_gender_for", {
		p_song_ids: songIds,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	return Result.ok(Number(data) || 0);
}

/**
 * Of the given Spotify ids, returns those already resolved or already checked
 * for a release year — i.e. `release_year IS NOT NULL OR release_year_checked_at
 * IS NOT NULL`. Ids absent from this set still need a getTrack lookup (this
 * includes ids not yet in the catalog, which are simply not returned). Selecting
 * only spotify_id keeps the payload tiny; batched like getByIds so a large
 * library never blows the PostgREST URL length on the `.in()` filter.
 */
export async function getResolvedOrCheckedReleaseYearIds(
	spotifyIds: string[],
): Promise<Result<Set<string>, DbError>> {
	if (spotifyIds.length === 0) {
		return Result.ok(new Set());
	}

	const supabase = createAdminSupabaseClient();
	const BATCH_SIZE = 100;
	const BATCH_CONCURRENCY = 4;
	const batches = chunkArray(spotifyIds, BATCH_SIZE);

	const batchResults = await mapWithConcurrency(
		batches,
		BATCH_CONCURRENCY,
		(batch) =>
			fromSupabaseMany(
				supabase
					.from("song")
					.select("spotify_id")
					.in("spotify_id", batch)
					.or("release_year.not.is.null,release_year_checked_at.not.is.null"),
			),
	);

	const done = new Set<string>();
	for (const result of batchResults) {
		if (Result.isError(result)) {
			return result;
		}
		for (const row of result.value) done.add(row.spotify_id);
	}
	return Result.ok(done);
}

/**
 * Bulk-applies extension getTrack release-year lookups via the
 * apply_release_year_lookups RPC: fills release_year where still missing and
 * stamps release_year_checked_at on every matched row, whether or not a year
 * resolved. Returns the number of catalog rows touched.
 */
export async function getActivelyLikedSpotifyIdsForAccount(
	accountId: string,
	spotifyIds: string[],
): Promise<Result<Set<string>, DbError>> {
	if (spotifyIds.length === 0) {
		return Result.ok(new Set());
	}

	const supabase = createAdminSupabaseClient();
	const SONG_BATCH_SIZE = 100;
	const SONG_BATCH_CONCURRENCY = 4;
	const uniqueSpotifyIds = [...new Set(spotifyIds)];
	const songBatches = chunkArray(uniqueSpotifyIds, SONG_BATCH_SIZE);

	const songResults = await mapWithConcurrency(
		songBatches,
		SONG_BATCH_CONCURRENCY,
		(batch) =>
			fromSupabaseMany<{ id: string; spotify_id: string }>(
				supabase.from("song").select("id, spotify_id").in("spotify_id", batch),
			),
	);

	const spotifyIdBySongId = new Map<string, string>();
	for (const result of songResults) {
		if (Result.isError(result)) {
			return result;
		}
		for (const row of result.value) {
			spotifyIdBySongId.set(row.id, row.spotify_id);
		}
	}

	const songIds = [...spotifyIdBySongId.keys()];
	if (songIds.length === 0) {
		return Result.ok(new Set());
	}

	const LIKE_BATCH_SIZE = 100;
	const LIKE_BATCH_CONCURRENCY = 4;
	const likeResults = await mapWithConcurrency(
		chunkArray(songIds, LIKE_BATCH_SIZE),
		LIKE_BATCH_CONCURRENCY,
		(batch) =>
			fromSupabaseMany<{ song_id: string }>(
				supabase
					.from("liked_song")
					.select("song_id")
					.eq("account_id", accountId)
					.is("unliked_at", null)
					.in("song_id", batch),
			),
	);

	const activeSpotifyIds = new Set<string>();
	for (const result of likeResults) {
		if (Result.isError(result)) {
			return result;
		}
		for (const row of result.value) {
			const spotifyId = spotifyIdBySongId.get(row.song_id);
			if (spotifyId) activeSpotifyIds.add(spotifyId);
		}
	}
	return Result.ok(activeSpotifyIds);
}

export async function applyReleaseYearLookups(
	lookups: ReadonlyArray<{ spotifyId: string; releaseYear: number | null }>,
): Promise<Result<number, DbError>> {
	if (lookups.length === 0) return Result.ok(0);

	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc("apply_release_year_lookups", {
		p_rows: lookups.map((l) => ({
			spotify_id: l.spotifyId,
			release_year: l.releaseYear,
		})),
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	return Result.ok(Number(data) || 0);
}

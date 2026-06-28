/**
 * Filter-metadata query helpers.
 *
 * Reads the song metadata and playlist filter config that the visibility policy
 * evaluates. Extracted so both card presentation (visible-suggestion-list) and
 * queue derivation (service.appendSnapshotDelta) fetch them the same way instead
 * of duplicating the query logic.
 *
 * All helpers use the service-role client (custom auth bypasses RLS) and return
 * Result<..., DbError> for composable error handling.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import { parseStoredMatchFilters } from "@/lib/domains/taste/match-filters/schemas";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";

/**
 * Fetches language, vocal gender, release year, and liked-at metadata for
 * a single song. Used by the song-orientation visible-list path to supply
 * songMeta to deriveVisibleSuggestions (MSR-36).
 *
 * liked_at is resolved from liked_song (active rows only; unliked_at IS NULL).
 * Returns a default-null metadata object when the song row is absent so
 * any active filter fails deterministically rather than passing silently.
 */
export async function fetchSongFilterMeta(
	accountId: string,
	songId: string,
): Promise<Result<SongFilterMetadata, DbError>> {
	const supabase = createAdminSupabaseClient();
	const [songResult, likedResult] = await Promise.all([
		supabase
			.from("song")
			.select("language, language_secondary, release_year, vocal_gender")
			.eq("id", songId)
			.maybeSingle(),
		supabase
			.from("liked_song")
			.select("liked_at")
			.eq("song_id", songId)
			.eq("account_id", accountId)
			.is("unliked_at", null)
			.maybeSingle(),
	]);
	if (songResult.error) {
		return Result.err(
			new DatabaseError({
				code: songResult.error.code,
				message: songResult.error.message,
			}),
		);
	}
	if (likedResult.error) {
		return Result.err(
			new DatabaseError({
				code: likedResult.error.code,
				message: likedResult.error.message,
			}),
		);
	}
	return Result.ok({
		language: songResult.data?.language ?? null,
		languageSecondary: songResult.data?.language_secondary ?? null,
		releaseYear: songResult.data?.release_year ?? null,
		vocalGender: songResult.data?.vocal_gender ?? null,
		likedAt: likedResult.data
			? new Date(likedResult.data.liked_at).getTime()
			: null,
	});
}

/**
 * Fetches language, vocal gender, release year, and liked-at metadata for
 * multiple songs in a single round-trip pair. Used by the playlist-orientation
 * visible-list path and by queue derivation (MSR-36).
 *
 * Songs not found in the song table are omitted from the returned map; callers
 * treat absent entries as all-null metadata, which causes any active filter to fail.
 */
export async function fetchSongsFilterMeta(
	accountId: string,
	songIds: readonly string[],
): Promise<Result<Map<string, SongFilterMetadata>, DbError>> {
	if (songIds.length === 0) return Result.ok(new Map());
	const ids = [...songIds];
	const supabase = createAdminSupabaseClient();
	const [songsResult, likedResult] = await Promise.all([
		supabase
			.from("song")
			.select("id, language, language_secondary, release_year, vocal_gender")
			.in("id", ids),
		supabase
			.from("liked_song")
			.select("song_id, liked_at")
			.in("song_id", ids)
			.eq("account_id", accountId)
			.is("unliked_at", null),
	]);
	if (songsResult.error) {
		return Result.err(
			new DatabaseError({
				code: songsResult.error.code,
				message: songsResult.error.message,
			}),
		);
	}
	if (likedResult.error) {
		return Result.err(
			new DatabaseError({
				code: likedResult.error.code,
				message: likedResult.error.message,
			}),
		);
	}
	const likedMap = new Map<string, number>();
	for (const row of likedResult.data ?? []) {
		likedMap.set(row.song_id, new Date(row.liked_at).getTime());
	}
	const metaMap = new Map<string, SongFilterMetadata>();
	for (const row of songsResult.data ?? []) {
		metaMap.set(row.id, {
			language: row.language,
			languageSecondary: row.language_secondary,
			releaseYear: row.release_year,
			vocalGender: row.vocal_gender,
			likedAt: likedMap.get(row.id) ?? null,
		});
	}
	return Result.ok(metaMap);
}

/**
 * Fetches match_filters for a set of playlists. Used in song-orientation to
 * supply per-suggestion-playlist filter config to deriveVisibleSuggestions.
 * Playlists with no match_filters row or null column map to null (no filter).
 */
export async function fetchPlaylistsMatchFilters(
	playlistIds: readonly string[],
): Promise<Result<Map<string, PlaylistMatchFiltersV1 | null>, DbError>> {
	if (playlistIds.length === 0) return Result.ok(new Map());
	const ids = [...playlistIds];
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("playlist")
		.select("id, match_filters")
		.in("id", ids);
	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	const map = new Map<string, PlaylistMatchFiltersV1 | null>();
	for (const row of data ?? []) {
		if (row.match_filters === null) {
			map.set(row.id, null);
		} else {
			const { value } = parseStoredMatchFilters(row.match_filters);
			map.set(row.id, value);
		}
	}
	return Result.ok(map);
}

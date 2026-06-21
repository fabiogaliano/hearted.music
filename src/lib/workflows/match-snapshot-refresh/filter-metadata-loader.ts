/**
 * Loads compact per-song metadata and account-scoped liked-date data for
 * hard-filter evaluation during match refresh.
 *
 * Designed to load once per refresh cycle: build two maps keyed by song ID,
 * then hand them to CMHF-11 which produces SongFilterMetadata per (song, playlist)
 * pair by merging the song-level fields with the account-scoped liked_at.
 *
 * Contract for CMHF-11:
 *   const maps = await loadFilterMetadata(accountId, songIds);
 *   const meta: SongFilterMetadata = {
 *     language:          maps.songMeta.get(songId)?.language ?? null,
 *     languageSecondary: maps.songMeta.get(songId)?.languageSecondary ?? null,
 *     releaseYear:       maps.songMeta.get(songId)?.releaseYear ?? null,
 *     vocalGender:       maps.songMeta.get(songId)?.vocalGender ?? null,
 *     likedAt:           maps.likedAtMs.get(songId) ?? null,
 *   };
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { DB_IN_FILTER_CHUNK_SIZE } from "@/lib/shared/utils/chunked-write";
import { chunkArray, mapWithConcurrency } from "@/lib/shared/utils/concurrency";
import { fromSupabaseMany } from "@/lib/shared/utils/result-wrappers/supabase";

const BATCH_CONCURRENCY = 4;

/**
 * Compact song-level filter fields — global, not account-scoped.
 * Mirrors the DB column names mapped to camelCase for TypeScript.
 */
export type SongFilterMeta = {
	language: string | null;
	languageSecondary: string | null;
	releaseYear: number | null;
	vocalGender: string | null;
};

/**
 * The two maps CMHF-11 consumes to assemble SongFilterMetadata per song.
 *
 * - songMeta:  keyed by song UUID → compact filter fields from the `song` table.
 *              Songs with no matching row are absent (treat all fields as null).
 * - likedAtMs: keyed by song UUID → liked_at as epoch milliseconds, ONLY for
 *              active (unliked_at IS NULL) rows scoped to the given account.
 *              Songs with no active liked row are absent (treat likedAt as null).
 */
export type FilterMetadataMaps = {
	songMeta: Map<string, SongFilterMeta>;
	likedAtMs: Map<string, number>;
};

type SongMetaRow = {
	id: string;
	language: string | null;
	language_secondary: string | null;
	release_year: number | null;
	vocal_gender: string | null;
};

type LikedAtRow = {
	song_id: string;
	liked_at: string;
};

async function loadSongMeta(
	songIds: string[],
): Promise<Map<string, SongFilterMeta>> {
	const supabase = createAdminSupabaseClient();
	const batches = chunkArray(songIds, DB_IN_FILTER_CHUNK_SIZE);

	const batchResults = await mapWithConcurrency(
		batches,
		BATCH_CONCURRENCY,
		(batch) =>
			fromSupabaseMany<SongMetaRow>(
				supabase
					.from("song")
					.select(
						"id, language, language_secondary, release_year, vocal_gender",
					)
					.in("id", batch),
			),
	);

	const map = new Map<string, SongFilterMeta>();
	for (const result of batchResults) {
		if (Result.isError(result)) {
			throw result.error;
		}
		for (const row of result.value) {
			map.set(row.id, {
				language: row.language,
				languageSecondary: row.language_secondary,
				releaseYear: row.release_year,
				vocalGender: row.vocal_gender,
			});
		}
	}
	return map;
}

async function loadLikedAtMs(
	accountId: string,
	songIds: string[],
): Promise<Map<string, number>> {
	const supabase = createAdminSupabaseClient();
	const batches = chunkArray(songIds, DB_IN_FILTER_CHUNK_SIZE);

	const batchResults = await mapWithConcurrency(
		batches,
		BATCH_CONCURRENCY,
		(batch) =>
			fromSupabaseMany<LikedAtRow>(
				supabase
					.from("liked_song")
					.select("song_id, liked_at")
					.eq("account_id", accountId)
					.is("unliked_at", null)
					.in("song_id", batch),
			),
	);

	const map = new Map<string, number>();
	for (const result of batchResults) {
		if (Result.isError(result)) {
			throw result.error;
		}
		for (const row of result.value) {
			// Convert ISO timestamp string to epoch ms for the predicate layer.
			map.set(row.song_id, new Date(row.liked_at).getTime());
		}
	}
	return map;
}

/**
 * Loads compact filter metadata for a set of candidate songs in a single refresh.
 *
 * Both the song-level fields and the account-scoped liked_at are fetched in
 * parallel and returned as pre-built maps so CMHF-11 can evaluate hard-filter
 * predicates in O(1) per song without additional DB round-trips.
 *
 * Returns Result.err on any DB failure so the orchestrator can degrade gracefully
 * (skip hard-filter exclusions rather than aborting the refresh).
 */
export async function loadFilterMetadata(
	accountId: string,
	songIds: string[],
): Promise<Result<FilterMetadataMaps, Error>> {
	if (songIds.length === 0) {
		return Result.ok({
			songMeta: new Map(),
			likedAtMs: new Map(),
		});
	}

	try {
		const [songMeta, likedAtMs] = await Promise.all([
			loadSongMeta(songIds),
			loadLikedAtMs(accountId, songIds),
		]);

		return Result.ok({ songMeta, likedAtMs });
	} catch (err) {
		return Result.err(err instanceof Error ? err : new Error(String(err)));
	}
}

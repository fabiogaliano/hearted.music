/**
 * Artist data operations.
 *
 * Normalized storage for artist metadata (image URLs).
 * Songs reference artists via artist_ids text[] (Spotify IDs).
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json, Tables } from "@/lib/data/database.types";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { chunkedWrite } from "@/lib/shared/utils/chunked-write";
import { chunkArray, mapWithConcurrency } from "@/lib/shared/utils/concurrency";
import { fromSupabaseMany } from "@/lib/shared/utils/result-wrappers/supabase";

export type Artist = Tables<"artist">;
export type ArtistWithImage = {
	spotify_id: Artist["spotify_id"];
	image_url: string;
};

/** One artist's resolved gender, ready for {@link applyGenderResolution}. */
export interface GenderResolution {
	spotify_id: string;
	/** Solo gender (local MB dump or Wikidata P21); null for bands/unresolved. */
	gender: "female" | "male" | "other" | null;
	/** Band gender from Wikidata membership; null for solo/unresolved. */
	band_gender: "female" | "male" | "mixed" | null;
	/** Wikidata QID when the fallback ran; null when resolved locally / no hit. */
	wikidata_id: string | null;
	/** Whether Wikidata was queried (stamps wikidata_checked_at). */
	wd_checked: boolean;
}

export interface ArtistUpsertData {
	spotify_id: string;
	name: string;
	image_url?: string | null;
	bio?: string | null;
}

export async function getLibraryArtistCount(
	accountId: string,
): Promise<Result<number, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.rpc("get_library_artist_count", { p_account_id: accountId })
		.single();

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(Number(data) || 0);
}

/**
 * Gets artists with cached images by Spotify ID.
 * Batches queries to avoid URI length limits.
 */
export async function getWithImagesBySpotifyIds(
	spotifyIds: string[],
): Promise<Result<ArtistWithImage[], DbError>> {
	if (spotifyIds.length === 0) {
		return Result.ok([]);
	}

	const uniqueSpotifyIds = [...new Set(spotifyIds)];
	const supabase = createAdminSupabaseClient();
	const BATCH_SIZE = 100;
	const BATCH_CONCURRENCY = 4;
	const batches = chunkArray(uniqueSpotifyIds, BATCH_SIZE);

	const batchResults = await mapWithConcurrency(
		batches,
		BATCH_CONCURRENCY,
		(batch) =>
			fromSupabaseMany<Pick<Artist, "spotify_id" | "image_url">>(
				supabase
					.from("artist")
					.select("spotify_id, image_url")
					.in("spotify_id", batch)
					.not("image_url", "is", null),
			),
	);

	const artistsWithImages: ArtistWithImage[] = [];
	for (const result of batchResults) {
		if (Result.isError(result)) {
			return Result.err(result.error);
		}

		artistsWithImages.push(
			...result.value.flatMap((artist) =>
				typeof artist.image_url === "string"
					? [
							{
								spotify_id: artist.spotify_id,
								image_url: artist.image_url,
							},
						]
					: [],
			),
		);
	}

	return Result.ok(artistsWithImages);
}

/**
 * Upserts artists by Spotify ID.
 * Updates name and only the non-null metadata provided on conflict.
 */
export function upsert(
	data: ArtistUpsertData[],
): Promise<Result<Artist[], DbError>> {
	if (data.length === 0) {
		return Promise.resolve(Result.ok<Artist[], DbError>([]));
	}
	const supabase = createAdminSupabaseClient();
	return chunkedWrite(data, async (chunk) => {
		const metadataRows = chunk
			.filter((artist) => artist.image_url != null || artist.bio != null)
			.map((artist) => ({
				spotify_id: artist.spotify_id,
				name: artist.name,
				...(artist.image_url != null ? { image_url: artist.image_url } : {}),
				...(artist.bio != null ? { bio: artist.bio } : {}),
			}));
		const nameOnlyRows = chunk
			.filter((artist) => artist.image_url == null && artist.bio == null)
			.map((artist) => ({
				spotify_id: artist.spotify_id,
				name: artist.name,
			}));

		const results = await Promise.all([
			metadataRows.length > 0
				? fromSupabaseMany(
						supabase
							.from("artist")
							.upsert(metadataRows, { onConflict: "spotify_id" })
							.select(),
					)
				: Promise.resolve(Result.ok<Artist[], DbError>([])),
			nameOnlyRows.length > 0
				? fromSupabaseMany(
						supabase
							.from("artist")
							.upsert(nameOnlyRows, { onConflict: "spotify_id" })
							.select(),
					)
				: Promise.resolve(Result.ok<Artist[], DbError>([])),
		]);

		const aggregated: Artist[] = [];
		for (const result of results) {
			if (Result.isError(result)) {
				return Result.err(result.error);
			}
			aggregated.push(...result.value);
		}

		return Result.ok(aggregated);
	});
}

/**
 * Of the given Spotify ids, returns those whose vocal gender hasn't been
 * attempted yet — no gender, no band_gender, and never checked against the
 * MusicBrainz dump. These are the artists Phase-1 resolution should process;
 * already-resolved and already-attempted artists are skipped, so reruns are
 * cheap and the local lookup never re-fires for a known miss.
 */
export async function getUnresolvedGenderArtists(
	spotifyIds: string[],
): Promise<Result<string[], DbError>> {
	if (spotifyIds.length === 0) return Result.ok([]);

	const uniqueIds = [...new Set(spotifyIds)];
	const supabase = createAdminSupabaseClient();
	const BATCH_SIZE = 100;
	const BATCH_CONCURRENCY = 4;

	const batchResults = await mapWithConcurrency(
		chunkArray(uniqueIds, BATCH_SIZE),
		BATCH_CONCURRENCY,
		(batch) =>
			fromSupabaseMany<Pick<Artist, "spotify_id">>(
				supabase
					.from("artist")
					.select("spotify_id")
					.in("spotify_id", batch)
					.is("gender", null)
					.is("band_gender", null)
					.is("musicbrainz_checked_at", null),
			),
	);

	const unresolved: string[] = [];
	for (const result of batchResults) {
		if (Result.isError(result)) return Result.err(result.error);
		for (const row of result.value) unresolved.push(row.spotify_id);
	}
	return Result.ok(unresolved);
}

/**
 * Bulk-applies resolved genders via the apply_artist_gender_resolution RPC
 * (idempotent, set-based). Returns the number of artist rows updated.
 */
export async function applyGenderResolution(
	rows: GenderResolution[],
): Promise<Result<number, DbError>> {
	if (rows.length === 0) return Result.ok(0);

	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc("apply_artist_gender_resolution", {
		p_rows: rows as unknown as Json,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	return Result.ok(Number(data) || 0);
}

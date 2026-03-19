/**
 * Artist data operations.
 *
 * Normalized storage for artist metadata (image URLs).
 * Songs reference artists via artist_ids text[] (Spotify IDs).
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import { fromSupabaseMany } from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Tables } from "@/lib/data/database.types";

export type Artist = Tables<"artist">;

export interface ArtistUpsertData {
	spotify_id: string;
	name: string;
	image_url: string | null;
}

/**
 * Upserts artists by Spotify ID.
 * Updates name and image_url on conflict.
 */
export function upsert(
	data: ArtistUpsertData[],
): Promise<Result<Artist[], DbError>> {
	if (data.length === 0) {
		return Promise.resolve(Result.ok<Artist[], DbError>([]));
	}
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("artist")
			.upsert(
				data.map((a) => ({
					spotify_id: a.spotify_id,
					name: a.name,
					image_url: a.image_url,
				})),
				{ onConflict: "spotify_id" },
			)
			.select(),
	);
}

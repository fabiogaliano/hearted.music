/**
 * Server fn that fetches album art + artist images for the four concept
 * exemplars from the local Supabase DB.
 *
 * Lives in its own .functions.ts file (matching the project's convention)
 * so that authMiddleware and createAdminSupabaseClient — both of which pull
 * in the node-postgres package via their transitive deps — are split out
 * of the client bundle by the TanStack Start build. Importing them directly
 * from a route module leaks postgres into the browser, where `Buffer` is
 * undefined and hydration silently crashes.
 */

import { createServerFn } from "@tanstack/react-start";
import { CONCEPT_SONGS } from "@/features/liked-songs/components/concept-panel/concept-data";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";

export type ConceptArtworkMap = Record<
	string,
	{ albumArtUrl: string | null; artistImageUrl: string | null }
>;

export const fetchConceptArtwork = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async (): Promise<ConceptArtworkMap> => {
		if (import.meta.env.PROD) {
			throw new Response("Not Found", { status: 404 });
		}

		const supabase = createAdminSupabaseClient();
		const trackIds = CONCEPT_SONGS.map((s) => s.spotifyTrackId);

		const { data: songs, error } = await supabase
			.from("song")
			.select("spotify_id, image_url, artist_ids")
			.in("spotify_id", trackIds);
		if (error) throw new Error(`song lookup failed: ${error.message}`);

		const artistIds = Array.from(
			new Set(
				(songs ?? [])
					.map((s) => s.artist_ids?.[0])
					.filter((id): id is string => typeof id === "string"),
			),
		);

		const artistImageMap = new Map<string, string | null>();
		if (artistIds.length > 0) {
			const { data: artists } = await supabase
				.from("artist")
				.select("spotify_id, image_url")
				.in("spotify_id", artistIds);
			for (const a of artists ?? []) {
				artistImageMap.set(a.spotify_id, a.image_url ?? null);
			}
		}

		const out: ConceptArtworkMap = {};
		for (const s of songs ?? []) {
			const primaryArtistId = s.artist_ids?.[0] ?? null;
			out[s.spotify_id] = {
				albumArtUrl: s.image_url ?? null,
				artistImageUrl: primaryArtistId
					? (artistImageMap.get(primaryArtistId) ?? null)
					: null,
			};
		}
		return out;
	});

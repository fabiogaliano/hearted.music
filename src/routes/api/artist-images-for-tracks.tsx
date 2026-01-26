/**
 * Artist Images API Route
 *
 * Fetches artist images for given track IDs without requiring user authentication.
 * Uses Spotify Client Credentials flow for app-level access.
 *
 * GET /api/artist-images-for-tracks?ids=track1,track2,track3
 *
 * Returns: { images: { [trackId]: imageUrl | null } }
 */

import { createFileRoute } from "@tanstack/react-router";
import { Result } from "better-result";
import { z } from "zod";
import { appFetch } from "@/lib/integrations/spotify/app-auth";

// Zod schemas for Spotify API responses
const TracksResponseSchema = z.object({
	tracks: z.array(
		z
			.object({
				id: z.string(),
				artists: z.array(z.object({ id: z.string() })),
			})
			.nullable(),
	),
});

const ArtistsResponseSchema = z.object({
	artists: z.array(
		z
			.object({
				id: z.string(),
				images: z.array(z.object({ url: z.string() })),
			})
			.nullable(),
	),
});

// Zod for input validation (Spotify track IDs are 22 chars alphanumeric)
const TrackIdSchema = z.string().regex(/^[a-zA-Z0-9]{22}$/);

export const Route = createFileRoute("/api/artist-images-for-tracks")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const result = await Result.gen(async function* () {
					// Parse & validate input with Zod
					const url = new URL(request.url);
					const rawIds = url.searchParams.get("ids")?.split(",") ?? [];
					const trackIds = rawIds
						.map((id) => TrackIdSchema.safeParse(id.trim()))
						.filter((r) => r.success)
						.map((r) => r.data!)
						.slice(0, 20); // Limit to 20 tracks (Spotify API limit)

					if (trackIds.length === 0) {
						return Result.ok({} as Record<string, string | null>);
					}

					// Fetch tracks → extract artist IDs
					const tracks = yield* Result.await(
						appFetch(`/tracks?ids=${trackIds.join(",")}`, TracksResponseSchema),
					);

					const artistIds = [
						...new Set(
							tracks.tracks
								.filter(Boolean)
								.flatMap((t) => t!.artists.map((a) => a.id)),
						),
					];

					if (artistIds.length === 0) {
						return Result.ok({} as Record<string, string | null>);
					}

					// Fetch artist details → extract images
					const artists = yield* Result.await(
						appFetch(
							`/artists?ids=${artistIds.join(",")}`,
							ArtistsResponseSchema,
						),
					);

					// Build artist ID → image URL mapping
					const artistImages = new Map(
						artists.artists
							.filter(Boolean)
							.map((a) => [a!.id, a!.images[0]?.url ?? null]),
					);

					// Build track ID → artist image mapping
					const images: Record<string, string | null> = {};
					for (const track of tracks.tracks) {
						if (track) {
							const artistId = track.artists[0]?.id;
							images[track.id] = artistId
								? (artistImages.get(artistId) ?? null)
								: null;
						}
					}

					return Result.ok(images);
				});

				// Graceful degradation - always return 200 even on errors
				// This is a decorative feature and shouldn't break the UI
				const images = Result.isOk(result) ? result.value : {};

				return Response.json(
					{ images },
					{
						headers: {
							"Cache-Control": "public, max-age=3600", // Cache for 1 hour
						},
					},
				);
			},
		},
	},
});

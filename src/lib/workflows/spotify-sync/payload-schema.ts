/**
 * Shared Zod schema for the extension sync payload.
 *
 * Extracted from the sync route so the Bun worker can import and validate the
 * staged Storage payload with the exact same contract. The CF Worker ingress no
 * longer parses the body at all (it streams it straight to Storage); full
 * validation now happens once, in the worker, against this schema.
 */

import { z } from "zod";

// Spotify-aligned ceilings: above any real library, below "this is an attack".
// Caps bound post-validation work (DB writes + per-row job enqueues). Body size
// is bounded separately by MAX_SYNC_BODY_BYTES in the route.
export const MAX_LIKED_SONGS = 50_000;
export const MAX_PLAYLISTS = 11_000;
export const MAX_TRACKS_PER_PLAYLIST = 10_000;

export const SpotifyTrackDTOSchema = z.object({
	added_at: z.string(),
	track: z.object({
		id: z.string(),
		name: z.string(),
		artists: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				imageUrl: z.string().nullable().optional(),
				bio: z.string().nullable().optional(),
			}),
		),
		album: z.object({
			id: z.string(),
			name: z.string(),
			images: z.array(
				z.object({
					url: z.string(),
					width: z.number().optional(),
					height: z.number().optional(),
				}),
			),
		}),
		duration_ms: z.number(),
		uri: z.string(),
		release_year: z.number().int().nullable().optional(),
	}),
});

export const SpotifyPlaylistDTOSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	owner: z.object({
		id: z.string(),
		name: z.string().optional(),
		image_url: z.string().nullable().optional(),
	}),
	track_count: z.number().nullable(),
	image_url: z.string().nullable(),
});

export const PlaylistTrackEntrySchema = z.object({
	playlistSpotifyId: z.string(),
	tracks: z.array(SpotifyTrackDTOSchema).max(MAX_TRACKS_PER_PLAYLIST),
});

export const SyncPayloadSchema = z.object({
	likedSongs: z.array(SpotifyTrackDTOSchema).max(MAX_LIKED_SONGS),
	playlists: z.array(SpotifyPlaylistDTOSchema).max(MAX_PLAYLISTS),
	playlistTracks: z
		.array(PlaylistTrackEntrySchema)
		.max(MAX_PLAYLISTS)
		.optional(),
	userProfile: z
		.object({
			spotifyId: z.string(),
			displayName: z.string().optional(),
			username: z.string().optional(),
			avatarUrl: z.string().nullable().optional(),
			email: z.string().optional(),
		})
		.optional(),
});

export type SyncPayload = z.infer<typeof SyncPayloadSchema>;

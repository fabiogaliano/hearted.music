/**
 * Shared Zod schema for the extension sync payload.
 *
 * Single source of truth for the shape the Chrome/Firefox extension uploads
 * (`POST /api/extension/sync`) and the Bun worker validates the staged
 * Storage payload against. Living in shared/ (like
 * spotify-command-protocol.ts) gives both the server-side workflow
 * (src/lib/workflows/spotify-sync/payload-schema.ts re-exports this) and the
 * extension (extensions/src/shared/types.ts derives its DTO types via
 * `z.infer`, as type-only imports so zod itself is never bundled into the
 * extension) a compiler-checked link to one definition instead of two
 * independently hand-maintained copies.
 */

import { z } from "zod";

// Spotify-aligned ceilings: above any real library, below "this is an attack".
// Caps bound post-validation work (DB writes + per-row job enqueues). Body size
// is bounded separately by MAX_SYNC_BODY_BYTES in the route.
export const MAX_LIKED_SONGS = 50_000;
export const MAX_PLAYLISTS = 11_000;
export const MAX_TRACKS_PER_PLAYLIST = 10_000;

export const SpotifyTrackArtistDTOSchema = z.object({
	id: z.string(),
	name: z.string(),
	imageUrl: z.string().nullable().optional(),
	bio: z.string().nullable().optional(),
});

export const SpotifyTrackDTOSchema = z.object({
	added_at: z.string(),
	track: z.object({
		id: z.string(),
		name: z.string(),
		artists: z.array(SpotifyTrackArtistDTOSchema),
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
		// Album release year. Playlist tracks carry it inline; the bulk liked-songs
		// query doesn't, so the extension hydrates liked songs with targeted
		// getTrack calls during sync. Null only when hydration hasn't reached the
		// track yet or couldn't resolve a year (those fall to manual review).
		release_year: z.number().int().nullable().optional(),
		// True when the extension attempted a liked-song getTrack release-year
		// lookup for this track during the current sync. The worker maps this to a
		// server-side release_year_checked_at stamp for newly-inserted songs.
		release_year_checked: z.boolean().optional(),
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
export type SpotifyTrackArtistDTO = z.infer<typeof SpotifyTrackArtistDTOSchema>;
export type SpotifyTrackDTO = z.infer<typeof SpotifyTrackDTOSchema>;
export type SpotifyPlaylistDTO = z.infer<typeof SpotifyPlaylistDTOSchema>;
export type PlaylistTrackEntry = z.infer<typeof PlaylistTrackEntrySchema>;

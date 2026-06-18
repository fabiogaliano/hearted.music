/**
 * Shared DTOs for Spotify sync workflows.
 *
 * These types define the shape of data the Chrome extension sends
 * to the backend after fetching from Spotify's Pathfinder API.
 */

import type { Song } from "@/lib/domains/library/songs/queries";

/** Artist within a Spotify track payload */
interface SpotifyTrackArtistDTO {
	id: string;
	name: string;
	imageUrl?: string | null;
	bio?: string | null;
}

/** Track payload from extension sync (liked songs or playlist tracks) */
export interface SpotifyTrackDTO {
	added_at: string;
	track: {
		id: string;
		name: string;
		artists: SpotifyTrackArtistDTO[];
		album: {
			id: string;
			name: string;
			images: Array<{
				url: string;
				width?: number;
				height?: number;
			}>;
		};
		duration_ms: number;
		uri: string;
		// Album release year when the source op carried it (playlist/getTrack);
		// liked-songs sync omits it, so it stays null until a getTrack backfill.
		release_year?: number | null;
	};
}

/** Playlist payload from extension sync */
export interface SpotifyPlaylistDTO {
	id: string;
	name: string;
	description: string | null;
	owner: { id: string };
	track_count: number | null;
	image_url: string | null;
}

/** Result of syncing liked songs */
export interface LikedSongsSyncResult {
	total: number;
	added: number;
	removed: number;
	newSongs: Song[];
}

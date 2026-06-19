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
		// Album release year. Playlist tracks carry it inline; the bulk liked-songs
		// query doesn't, so the extension hydrates liked songs with targeted
		// getTrack calls during sync. Null only when hydration hasn't reached the
		// track yet or couldn't resolve a year (those fall to manual review).
		release_year?: number | null;
		// True when the extension attempted a liked-song getTrack release-year
		// lookup for this track during this sync. The worker maps it to a
		// server-side release_year_checked_at stamp for newly-inserted songs.
		release_year_checked?: boolean;
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

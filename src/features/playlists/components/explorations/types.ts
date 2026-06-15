/**
 * View models for the playlists redesign explorations. These mirror the real
 * `playlist` row (see @/lib/domains/library/playlists/queries) but in clean
 * camelCase so the exploration components stay presentational and easy to tweak.
 * Field mapping for the eventual wire-up:
 *   intent    → playlist.match_intent
 *   genres    → playlist.genre_pills
 *   imageUrl  → playlist.image_url
 *   songCount → playlist.song_count
 *   isTarget  → playlist.is_target
 */
export interface PlaylistSummary {
	id: string;
	name: string;
	/** In the "matching" set (true) vs the wider library (false). */
	isTarget: boolean;
	songCount: number;
	imageUrl: string | null;
	/** What the user wrote this playlist is for — the matching intent. */
	intent: string | null;
	genres: string[];
}

/** A track row for the detail panel. Mirrors server PlaylistTrack, minus ids. */
export interface PlaylistTrackVM {
	position: number;
	name: string;
	artists: string[];
	albumName: string | null;
	imageUrl: string | null;
}

/** What a playlist "is for": only the user's own matching intent — never the
 * imported Spotify description, which isn't part of matching. */
export function playlistPurpose(p: PlaylistSummary): string | null {
	return p.intent;
}

/** Whether the matcher has anything to route songs by — an explicit intent, or
 * genres to fall back on. Mirrors the "intent OR genres" rule the matching notice
 * states: a playlist with neither can't be matched yet. */
export function isMatchable(p: PlaylistSummary): boolean {
	return Boolean(p.intent) || p.genres.length > 0;
}

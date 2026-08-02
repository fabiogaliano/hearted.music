/**
 * View-models for the sidebar-less navigation exploration.
 *
 * Prod mapping, for promotion:
 * - matchCount / matchPreviews ← the dashboard loader's review count +
 *   `MatchPreview[]` (src/features/dashboard/types.ts)
 * - recentSongs ← latest `liked_song` joins (title/artist/cover from `song`)
 * - playlists ← `Tables<"playlist">`: `name`, `image_url`, track counts from
 *   `playlist_song`
 * - handle / planLabel ← `account.handle` + the billing plan the sidebar
 *   footer strip shows today
 */

export type Destination =
	| "home"
	| "match"
	| "liked-songs"
	| "playlists"
	| "settings";

/** Sketch A ("pure": wordmark + profile only) vs Sketch B ("line": masthead nav). */
export type MastheadVariant = "pure" | "line";

/** The hub layout directions: baseline stack, two-column magazine, cover-wall
 * gallery, and grain-paneled ceramic (design-evolution/vision.md). */
export type FrontPageComposition =
	| "stack"
	| "editorial"
	| "gallery"
	| "ceramic";

export interface MatchPreviewVM {
	id: number;
	image: string;
	name: string;
	artist: string;
}

export interface SongVM {
	id: string;
	title: string;
	artist: string;
	coverUrl: string;
	likedAgo: string;
}

export interface PlaylistVM {
	id: string;
	name: string;
	coverUrl: string;
	trackCount: number;
}

export interface HubData {
	handle: string;
	planLabel: string;
	matchCount: number;
	matchPreviews: MatchPreviewVM[];
	likedCount: number;
	recentSongs: SongVM[];
	playlistCount: number;
	playlists: PlaylistVM[];
}

/** Every front-page composition renders from the same contract, so the
 * AppFrame simulator can host any of them interchangeably. */
export interface FrontPageProps {
	data: HubData;
	onNavigate: (destination: Destination) => void;
}

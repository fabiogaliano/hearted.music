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

import type { ReactNode } from "react";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { DescriptionExample } from "./DescriptionExamplesShuffle";

/**
 * Everything that makes the playlists screen a guided onboarding rehearsal. Its
 * PRESENCE activates guided mode; absence means production defaults. All fields
 * must be set together — the type makes incoherent partial configs unrepresentable
 * by keeping them in one object that only the sandbox screen constructs.
 */
export interface GuidedPlaylistsConfig {
	/** Lock the panel shut during forced walkthrough beats (hides ✕, no-ops scrim/Escape). */
	locked: boolean;
	/** Pulse the add toggle as the walkthrough "add it" spotlight target. */
	highlightAdd: boolean;
	/** Drop straight into the intent editor the moment this playlist is added. */
	autoEditOnAdd: boolean;
	/** Override the editor textarea placeholder. */
	intentPlaceholder: string;
	/** Per-playlist intent examples for the guided pick-to-fill flow. */
	examples: readonly DescriptionExample[] | undefined;
	/** Override the Matching shelf empty-state headline. */
	matchingEmptyTitle: string;
	/** Override the Matching shelf empty-state body. */
	matchingEmptyBody: string;
	/** Action rendered below the Matching empty state (e.g. walkthrough "Next"). */
	matchingEmptyAction: ReactNode;
}

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
	/** Parsed hard filters — always normalized, never raw DB JSON. */
	matchFilters: PlaylistMatchFiltersV1;
}

/** A track row for the detail panel. Mirrors server PlaylistTrack, minus ids. */
export interface PlaylistTrackVM {
	position: number;
	name: string;
	artists: string[];
	albumName: string | null;
	imageUrl: string | null;
	/** Spotify track id for the inline preview player. Optional so hand-built
	 *  fixtures/stories can omit it — those rows just render a plain cover. */
	spotifyId?: string | null;
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

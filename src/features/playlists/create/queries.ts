/**
 * Query options factory for the stateless playlist draft preview engine.
 *
 * Kept in a dedicated module so the route loader and the draft-state hook
 * can both import from a single stable path rather than duplicating
 * queryKey derivation logic.
 */

import { queryOptions } from "@tanstack/react-query";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { previewPlaylistDraft } from "@/lib/server/playlist-draft.functions";
import {
	resolveLikedArtistSongs,
	searchLikedArtists,
} from "@/lib/server/playlists.functions";

export interface DraftConfig {
	intent?: string;
	genrePills: string[];
	matchFilters: PlaylistMatchFiltersV1;
	maxSongs: number;
	pinnedSongIds: string[];
	/** The hand-picked, filter-exempt subset of pinnedSongIds. */
	manualPinnedSongIds: string[];
	excludedSongIds: string[];
	/** Pages the suggestions window deeper; bumped by "Refresh suggestions". */
	suggestionsOffset: number;
}

export const DEFAULT_DRAFT_CONFIG: DraftConfig = {
	intent: undefined,
	genrePills: [],
	matchFilters: { version: 1 },
	maxSongs: 15,
	pinnedSongIds: [],
	manualPinnedSongIds: [],
	excludedSongIds: [],
	suggestionsOffset: 0,
};

// Keys are stable and derived from the full config so any parameter change
// triggers a fresh fetch while identical configs share the cache.
export const draftPreviewKeys = {
	all: ["playlist-draft-preview"] as const,
	preview: (config: DraftConfig) =>
		[
			"playlist-draft-preview",
			config.maxSongs,
			config.intent ?? null,
			config.genrePills,
			config.matchFilters,
			config.pinnedSongIds,
			config.manualPinnedSongIds,
			config.excludedSongIds,
			config.suggestionsOffset,
		] as const,
};

/**
 * Query options for the playlist draft preview.
 *
 * staleTime is intentionally short (30s): the user's library can change via
 * background enrichment while they are on the creation page, so we allow a
 * fresh fetch after each debounce cycle without hammering the server.
 */
export function playlistDraftPreviewQueryOptions(config: DraftConfig) {
	return queryOptions({
		queryKey: draftPreviewKeys.preview(config),
		queryFn: () =>
			previewPlaylistDraft({
				data: {
					intent: config.intent,
					genrePills: config.genrePills,
					matchFilters: config.matchFilters,
					maxSongs: config.maxSongs,
					pinnedSongIds: config.pinnedSongIds,
					manualPinnedSongIds: config.manualPinnedSongIds,
					excludedSongIds: config.excludedSongIds,
					suggestionsOffset: config.suggestionsOffset,
				},
			}),
		staleTime: 30_000,
	});
}

/**
 * Filter-aware resolution of the studio's selected artists into pinnable song
 * ids. Keyed on the DEBOUNCED match filters (the caller passes those), so a
 * filter change re-resolves exactly once per settle — chip counts and the
 * balanced allocation both read from this one source.
 */
export function artistSongResolutionQueryOptions(
	artists: string[],
	matchFilters: PlaylistMatchFiltersV1,
) {
	return queryOptions({
		queryKey: ["liked-artist-song-resolution", artists, matchFilters] as const,
		queryFn: () => resolveLikedArtistSongs({ data: { artists, matchFilters } }),
		enabled: artists.length > 0,
		staleTime: 30_000,
	});
}

/**
 * Type-to-search over the account's liked artists (name + like count, ranked
 * by like count). An empty query returns the full ranked aggregate, which the
 * ArtistConfig panel uses as its browse list.
 */
export function likedArtistSearchQueryOptions(query: string) {
	return queryOptions({
		queryKey: ["liked-artist-search", query] as const,
		queryFn: () => searchLikedArtists({ data: { query } }),
		staleTime: 60_000,
	});
}

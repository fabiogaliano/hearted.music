import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import {
	getAccountTopGenres,
	getPlaylistManagementData,
	getPlaylistMatchFilterOptions,
	getPlaylistTracksPage,
} from "@/lib/server/playlists.functions";

export const PLAYLIST_TRACKS_PAGE_SIZE = 25;

export const playlistKeys = {
	all: ["playlists"] as const,
	management: (accountId: string) =>
		["playlists", "management", accountId] as const,
	tracks: (playlistId: string) => ["playlists", "tracks", playlistId] as const,
	topGenres: (accountId: string) =>
		["playlists", "top-genres", accountId] as const,
	filterOptions: (accountId: string) =>
		["playlists", "filter-options", accountId] as const,
};

export function playlistManagementQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: playlistKeys.management(accountId),
		queryFn: () => getPlaylistManagementData(),
		staleTime: 30 * 60_000,
	});
}

export function accountTopGenresQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: playlistKeys.topGenres(accountId),
		queryFn: () => getAccountTopGenres(),
		// Library composition shifts slowly; the picker just needs a reasonable
		// seed, so a long stale window keeps this off the critical path.
		staleTime: 30 * 60_000,
	});
}

/**
 * Query options for the filter-options RPC. Account-scoped; no playlistId
 * needed — CMHF-14 can consume this directly to populate filter controls.
 *
 * staleTime is intentionally shorter than management data: language counts and
 * release-year bounds shift as the enrichment pipeline processes new songs.
 */
export function playlistMatchFilterOptionsQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: playlistKeys.filterOptions(accountId),
		queryFn: () => getPlaylistMatchFilterOptions(),
		staleTime: 5 * 60_000,
	});
}

export function playlistTracksInfiniteQueryOptions(playlistId: string | null) {
	return infiniteQueryOptions({
		queryKey: playlistKeys.tracks(playlistId ?? ""),
		queryFn: ({ pageParam }) =>
			getPlaylistTracksPage({
				data: {
					playlistId: playlistId as string,
					cursor: pageParam,
					limit: PLAYLIST_TRACKS_PAGE_SIZE,
				},
			}),
		enabled: playlistId != null,
		initialPageParam: undefined as number | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		staleTime: 30 * 60_000,
	});
}

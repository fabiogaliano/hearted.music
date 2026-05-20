import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import {
	getPlaylistManagementData,
	getPlaylistTracksPage,
} from "@/lib/server/playlists.functions";

export const PLAYLIST_TRACKS_PAGE_SIZE = 25;

export const playlistKeys = {
	all: ["playlists"] as const,
	management: (accountId: string) =>
		["playlists", "management", accountId] as const,
	tracks: (playlistId: string) => ["playlists", "tracks", playlistId] as const,
};

export function playlistManagementQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: playlistKeys.management(accountId),
		queryFn: () => getPlaylistManagementData(),
		staleTime: 30 * 60_000,
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

import { queryOptions } from "@tanstack/react-query";
import {
	getPlaylistManagementData,
	getPlaylistTrackPreview,
} from "@/lib/server/playlists.functions";

export const playlistKeys = {
	all: ["playlists"] as const,
	management: (accountId: string) =>
		["playlists", "management", accountId] as const,
	trackPreview: (playlistId: string) =>
		["playlists", "track-preview", playlistId] as const,
};

export function playlistManagementQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: playlistKeys.management(accountId),
		queryFn: () => getPlaylistManagementData(),
		staleTime: 30 * 60_000,
	});
}

export function playlistTrackPreviewQueryOptions(playlistId: string | null) {
	return queryOptions({
		queryKey: playlistKeys.trackPreview(playlistId ?? ""),
		queryFn: () =>
			getPlaylistTrackPreview({ data: { playlistId: playlistId! } }),
		enabled: playlistId != null,
		staleTime: 30 * 60_000,
	});
}

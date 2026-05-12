import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { songSuggestionsQueryOptions } from "../queries";
import type { LikedSong } from "../types";

interface UseSongSuggestionPrefetchOptions {
	displayedSongs: readonly LikedSong[];
	displayedSongIndexById: ReadonlyMap<string, number>;
}

export function useSongSuggestionPrefetch({
	displayedSongs,
	displayedSongIndexById,
}: UseSongSuggestionPrefetchOptions) {
	const queryClient = useQueryClient();

	return useCallback(
		(songId: string) => {
			queryClient.prefetchQuery(songSuggestionsQueryOptions(songId));

			const songIndex = displayedSongIndexById.get(songId);
			if (songIndex == null) return;

			const adjacentSongIds = [
				displayedSongs[songIndex + 1]?.track.id,
				displayedSongs[songIndex - 1]?.track.id,
			].filter((id): id is string => id != null);

			for (const adjacentSongId of adjacentSongIds) {
				queryClient.prefetchQuery(songSuggestionsQueryOptions(adjacentSongId));
			}
		},
		[displayedSongIndexById, displayedSongs, queryClient],
	);
}

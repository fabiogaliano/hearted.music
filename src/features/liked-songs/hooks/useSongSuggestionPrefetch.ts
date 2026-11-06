import { noop, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	likedSongAnalysisQueryOptions,
	songSuggestionsQueryOptions,
} from "../queries";
import { hasStoredAnalysis, type LikedSong } from "../types";

interface UseSongSuggestionPrefetchOptions {
	accountId: string;
	displayedSongs: readonly LikedSong[];
	displayedSongIndexById: ReadonlyMap<string, number>;
}

/**
 * Warms what the detail panel reads for a song and its list neighbours (its
 * playlist suggestions and its analysis), so panel prev/next and keyboard
 * navigation land on cached data instead of flashing a loading state.
 */
export function useSongSuggestionPrefetch({
	accountId,
	displayedSongs,
	displayedSongIndexById,
}: UseSongSuggestionPrefetchOptions) {
	const queryClient = useQueryClient();

	return useCallback(
		(songId: string) => {
			const songIndex = displayedSongIndexById.get(songId);
			if (songIndex == null) {
				queryClient.query(songSuggestionsQueryOptions(songId)).catch(noop);
				return;
			}

			const songs = [
				displayedSongs[songIndex],
				displayedSongs[songIndex + 1],
				displayedSongs[songIndex - 1],
			].filter((song): song is LikedSong => song != null);

			for (const song of songs) {
				queryClient
					.query(songSuggestionsQueryOptions(song.track.id))
					.catch(noop);
				if (hasStoredAnalysis(song)) {
					queryClient
						.query(likedSongAnalysisQueryOptions(accountId, song.track.id))
						.catch(noop);
				}
			}
		},
		[accountId, displayedSongIndexById, displayedSongs, queryClient],
	);
}

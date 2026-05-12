import { useCallback, useMemo } from "react";
import type { LikedSong } from "../types";
import { useInfiniteScroll } from "./useInfiniteScroll";
import { useSongSuggestionPrefetch } from "./useSongSuggestionPrefetch";

interface UseLikedSongsListModelOptions {
	displayedSongs: readonly LikedSong[];
	displayedSongIndexById: ReadonlyMap<string, number>;
	fetchNextPage: () => unknown;
	hasNextPage: boolean | undefined;
	isFetchingNextPage: boolean;
	isWalkthrough: boolean;
	walkthroughSongId: string | null;
	selectionMode: boolean;
	showSelectionUI: boolean;
}

export function useLikedSongsListModel({
	displayedSongs,
	displayedSongIndexById,
	fetchNextPage,
	hasNextPage,
	isFetchingNextPage,
	isWalkthrough,
	walkthroughSongId,
	selectionMode,
	showSelectionUI,
}: UseLikedSongsListModelOptions) {
	const visibleSongs = useMemo(
		() =>
			selectionMode && showSelectionUI
				? displayedSongs.filter((song) => song.displayState === "locked")
				: displayedSongs,
		[displayedSongs, selectionMode, showSelectionUI],
	);

	const hasMore = isWalkthrough ? false : (hasNextPage ?? false);
	const handleLoadMore = useCallback(() => {
		if (!isFetchingNextPage && hasNextPage) {
			void fetchNextPage();
		}
	}, [fetchNextPage, hasNextPage, isFetchingNextPage]);

	const { sentinelRef } = useInfiniteScroll({
		onLoadMore: handleLoadMore,
		hasMore,
	});

	const prefetchAdjacentSuggestions = useSongSuggestionPrefetch({
		displayedSongs,
		displayedSongIndexById,
	});

	const navItems = useMemo(
		() =>
			isWalkthrough && walkthroughSongId !== null
				? displayedSongs.filter((song) => song.track.id === walkthroughSongId)
				: visibleSongs,
		[displayedSongs, isWalkthrough, visibleSongs, walkthroughSongId],
	);

	const navIndexBySongId = useMemo(
		() => new Map(navItems.map((song, index) => [song.track.id, index])),
		[navItems],
	);

	return {
		visibleSongs,
		hasMore,
		handleLoadMore,
		sentinelRef,
		prefetchAdjacentSuggestions,
		navItems,
		navIndexBySongId,
	};
}

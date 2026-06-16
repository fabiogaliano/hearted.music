import { useCallback, useEffect, useMemo } from "react";
import { useInfiniteScroll } from "@/lib/hooks/useInfiniteScroll";
import type { SearchFilter } from "../filter";
import type { LikedSong } from "../types";
import { useSongSuggestionPrefetch } from "./useSongSuggestionPrefetch";

interface UseLikedSongsListModelOptions {
	displayedSongs: readonly LikedSong[];
	displayedSongIndexById: ReadonlyMap<string, number>;
	fetchNextPage: () => unknown;
	hasNextPage: boolean | undefined;
	isFetchingNextPage: boolean;
	isWalkthrough: boolean;
	selectionMode: boolean;
	showSelectionUI: boolean;
	activeFilter: SearchFilter;
}

export function useLikedSongsListModel({
	displayedSongs,
	displayedSongIndexById,
	fetchNextPage,
	hasNextPage,
	isFetchingNextPage,
	isWalkthrough,
	selectionMode,
	showSelectionUI,
	activeFilter,
}: UseLikedSongsListModelOptions) {
	// Show only locked songs when either the user is in unlock-selection mode
	// or they've explicitly filtered to "locked". Both paths reuse the same
	// auto-paginate loop below so sparsely-distributed locked rows still
	// surface without the user having to scroll.
	const showLockedOnly =
		(selectionMode && showSelectionUI) || activeFilter === "locked";

	const visibleSongs = useMemo(
		() =>
			showLockedOnly
				? displayedSongs.filter((song) => song.displayState === "locked")
				: displayedSongs,
		[displayedSongs, showLockedOnly],
	);

	const hasMore = isWalkthrough ? false : (hasNextPage ?? false);
	const handleLoadMore = useCallback(() => {
		if (!isFetchingNextPage && hasNextPage) {
			void fetchNextPage();
		}
	}, [fetchNextPage, hasNextPage, isFetchingNextPage]);

	useEffect(() => {
		if (
			showLockedOnly &&
			visibleSongs.length === 0 &&
			hasMore &&
			!isFetchingNextPage
		) {
			handleLoadMore();
		}
	}, [
		showLockedOnly,
		visibleSongs.length,
		hasMore,
		isFetchingNextPage,
		handleLoadMore,
	]);

	const { sentinelRef } = useInfiniteScroll({
		onLoadMore: handleLoadMore,
		hasMore,
	});

	const prefetchAdjacentSuggestions = useSongSuggestionPrefetch({
		displayedSongs,
		displayedSongIndexById,
	});

	// The walkthrough library is fully navigable now that it holds the hero plus
	// curated companions — keyboard nav and clicks span all of them, same as the
	// real list. (The hero is still visually spotlighted by the list component.)
	const navItems = visibleSongs;

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

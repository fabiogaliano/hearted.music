import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WalkthroughSong } from "@/lib/domains/library/accounts/onboarding-session";
import {
	accountEventsConnectionKey,
	type ConnectionState,
} from "@/lib/hooks/useAccountEvents";
import { useInfiniteScroll } from "@/lib/hooks/useInfiniteScroll";
import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";
import { scrollListElementIntoView } from "@/lib/keyboard/listScroll";
import type {
	ListNavigationSource,
	ListScrollBlock,
} from "@/lib/keyboard/types";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import type { SearchFilter } from "../filter";
import { type FilterOption, likedSongsStatsQueryOptions } from "../queries";
import type { LikedSong } from "../types";
import { useLikedSongsCollection } from "./useLikedSongsCollection";
import { useSelectedLikedSongBySlug } from "./useSelectedLikedSongBySlug";
import { useSongExpansion } from "./useSongExpansion";
import { useSongSuggestionPrefetch } from "./useSongSuggestionPrefetch";

/**
 * Refetch cadence for the liked-songs stats query. Polls while enrichment is
 * running and the realtime stream hasn't taken over; otherwise the stream (or
 * a one-shot fetch) is authoritative.
 */
export function likedSongsStatsRefetchInterval(
	isEnrichmentRunning: boolean,
	connectionState: ConnectionState,
): number | false {
	if (!isEnrichmentRunning || connectionState === "connected") return false;
	return 5_000;
}

/**
 * Which rows are visible in the list right now. Selection mode and the
 * "locked" filter both narrow to locked-only rows so unlock candidates are
 * easy to scan; everything else shows the full displayed set.
 */
export function computeVisibleSongs(
	displayedSongs: readonly LikedSong[],
	showLockedOnly: boolean,
): readonly LikedSong[] {
	return showLockedOnly
		? displayedSongs.filter((song) => song.displayState === "locked")
		: displayedSongs;
}

interface PendingSelectionFocus {
	songId: string;
	mode: "keyboard" | "pointer";
	scrollBlock: ListScrollBlock;
}

interface UseLikedSongsListOptions {
	accountId: string;
	filter: FilterOption;
	activeFilter: SearchFilter;
	search?: string;
	selectedSlug?: string | null;
	isWalkthrough: boolean;
	walkthroughSong: WalkthroughSong | null;
	companionSongs?: readonly WalkthroughSong[];
	isEnrichmentRunning: boolean;
	selectionMode: boolean;
	showSelectionUI: boolean;
	selectionBarHeight: number;
	enterSelectionMode: () => void;
	toggleSongSelection: (songId: string) => void;
	clearSelectionMode: () => void;
}

/**
 * Owns everything the liked-songs list needs to render and navigate: the
 * paginated collection, the deep-link song lookup, stats polling, which rows
 * are visible under the current filter/selection mode, panel expansion (via
 * useSongExpansion), and keyboard/pointer activation + focus tracking.
 * Collapses what used to be a four-hook relay (page data → list model →
 * activation → controller) into one module so the page consumes a single
 * {state, panel, actions} triple instead of re-wiring ~30 intermediate values
 * between hooks.
 */
export function useLikedSongsList({
	accountId,
	filter,
	activeFilter,
	search,
	selectedSlug,
	isWalkthrough,
	walkthroughSong,
	companionSongs,
	isEnrichmentRunning,
	selectionMode,
	showSelectionUI,
	selectionBarHeight,
	enterSelectionMode,
	toggleSongSelection,
	clearSelectionMode,
}: UseLikedSongsListOptions) {
	const {
		isLoading,
		displayedSongs,
		displayedSongIndexById,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useLikedSongsCollection({
		accountId,
		filter,
		search,
		isWalkthrough,
		walkthroughSong,
		companionSongs,
	});

	const { selectedSongFromUrl, selectedSongIdFromUrl, isSelectedSlugResolved } =
		useSelectedLikedSongBySlug({
			accountId,
			displayedSongs,
			selectedSlug,
		});

	const { data: connectionState } = useQuery<ConnectionState>({
		queryKey: accountEventsConnectionKey(accountId),
		queryFn: () => "disconnected",
		initialData: "disconnected",
		staleTime: Number.POSITIVE_INFINITY,
	});

	const { data: stats } = useQuery({
		...likedSongsStatsQueryOptions(accountId),
		refetchInterval: likedSongsStatsRefetchInterval(
			isEnrichmentRunning,
			connectionState,
		),
	});

	const {
		selectedSong,
		selectedSongId,
		isExpanded,
		containerRef,
		hasNext,
		hasPrevious,
		handleExpand,
		openSong,
		handleNext,
		handlePrevious,
		handleClose,
		closingToSongId,
	} = useSongExpansion(displayedSongs, {
		selectedSlug,
		fallbackSelectedSong: selectedSongFromUrl,
		isSelectedSlugResolved,
	});

	// The URL-driven focus sync below only fires once per page load — for the
	// slug the page mounted with, not for every subsequent selection change
	// (panel-nav, unlock reveal, etc. manage focus themselves).
	const initialSelectedSlugRef = useRef(selectedSlug ?? null);
	const shouldSyncInitialUrlSelection =
		initialSelectedSlugRef.current !== null &&
		selectedSlug === initialSelectedSlugRef.current;

	// Show only locked songs when either the user is in unlock-selection mode
	// or they've explicitly filtered to "locked". Both paths reuse the same
	// auto-paginate loop below so sparsely-distributed locked rows still
	// surface without the user having to scroll.
	const showLockedOnly =
		(selectionMode && showSelectionUI) || activeFilter === "locked";

	const visibleSongs = useMemo(
		() => computeVisibleSongs(displayedSongs, showLockedOnly),
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

	// --- activation (locked → selection toggle; unlocked → expand panel) ---

	const focusedSongIdRef = useRef<string | null>(null);
	const pendingSelectionFocusRef = useRef<PendingSelectionFocus | null>(null);
	const pendingCursorScrollBlocksRef = useRef<
		Map<number, ListScrollBlock | null>
	>(new Map());
	const pendingRouteSelectionSourceRef = useRef<ListNavigationSource | null>(
		null,
	);

	const queueSelectionFocus = useCallback((focus: PendingSelectionFocus) => {
		pendingSelectionFocusRef.current = focus;
	}, []);

	const markRouteSelectionSource = useCallback(
		(source: ListNavigationSource) => {
			pendingRouteSelectionSourceRef.current = source;
		},
		[],
	);

	const songById = useMemo(() => {
		const map = new Map<string, LikedSong>();
		for (const song of displayedSongs) {
			map.set(song.track.id, song);
		}
		return map;
	}, [displayedSongs]);

	const activateSong = useCallback(
		(
			song: LikedSong,
			element: HTMLElement | null,
			routeSource: Extract<ListNavigationSource, "keyboard" | "pointer">,
			selectionFocusMode: PendingSelectionFocus["mode"],
		) => {
			if (song.displayState === "locked" && showSelectionUI) {
				if (!selectionMode) {
					queueSelectionFocus({
						songId: song.track.id,
						mode: selectionFocusMode,
						scrollBlock: "start",
					});
					enterSelectionMode();
				}
				toggleSongSelection(song.track.id);
				return;
			}

			if (!element) return;
			markRouteSelectionSource(routeSource);
			handleExpand(song, element);
			prefetchAdjacentSuggestions(song.track.id);
		},
		[
			enterSelectionMode,
			handleExpand,
			markRouteSelectionSource,
			prefetchAdjacentSuggestions,
			queueSelectionFocus,
			selectionMode,
			showSelectionUI,
			toggleSongSelection,
		],
	);

	const handleCardClick = useCallback(
		(songId: string, element: HTMLElement) => {
			const song = songById.get(songId);
			if (!song) return;

			activateSong(song, element, "pointer", "pointer");
		},
		[activateSong, songById],
	);

	// --- keyboard/pointer navigation + focus tracking ---

	const {
		focusedIndex,
		interactionMode,
		lastCursorChange,
		syncFocusedIndex,
		getFocusedElement,
		getElementAtIndex,
		focusFocusedItem,
		getItemProps,
	} = useListNavigation<LikedSong>({
		items: navItems,
		scope: "liked-list",
		enabled: !isExpanded && navItems.length > 0,
		onFocusChange: (_index, song) => {
			focusedSongIdRef.current = song?.track.id ?? null;
		},
		onSelect: (song, _index, element) => {
			activateSong(
				song,
				element,
				"keyboard",
				interactionMode === "pointer" ? "pointer" : "keyboard",
			);
		},
		getId: (song) => song.track.id,
		onLoadMore: handleLoadMore,
		hasMore,
		scrollBlock: "center",
		autoScroll: false,
	});

	const openFocusedSong = useCallback(() => {
		if (focusedIndex < 0 || focusedIndex >= navItems.length) return;

		const song = navItems[focusedIndex];
		const element = getFocusedElement();
		if (!element) return;

		markRouteSelectionSource("keyboard");
		handleExpand(song, element);
		prefetchAdjacentSuggestions(song.track.id);
	}, [
		focusedIndex,
		navItems,
		getFocusedElement,
		handleExpand,
		markRouteSelectionSource,
		prefetchAdjacentSuggestions,
	]);

	const queueCursorScrollBlock = useCallback(
		(sequence: number, block: ListScrollBlock | null) => {
			pendingCursorScrollBlocksRef.current.set(sequence, block);
		},
		[],
	);

	const exitSelectionMode = useCallback(() => {
		const focusedSongId = focusedSongIdRef.current;
		if (focusedSongId) {
			queueSelectionFocus({
				songId: focusedSongId,
				mode: interactionMode === "pointer" ? "pointer" : "keyboard",
				scrollBlock: "start",
			});
		}

		clearSelectionMode();
	}, [clearSelectionMode, interactionMode, queueSelectionFocus]);

	const prevUrlSelectedSongIdRef = useRef<string | null>(null);
	const hasSyncedInitialUrlSelectionRef = useRef(false);
	useEffect(() => {
		if (!selectedSongIdFromUrl) {
			prevUrlSelectedSongIdRef.current = null;
			return;
		}

		if (selectedSongIdFromUrl === prevUrlSelectedSongIdRef.current) return;

		if (pendingRouteSelectionSourceRef.current !== null) {
			pendingRouteSelectionSourceRef.current = null;
			prevUrlSelectedSongIdRef.current = selectedSongIdFromUrl;
			return;
		}

		if (
			hasSyncedInitialUrlSelectionRef.current ||
			!shouldSyncInitialUrlSelection
		) {
			prevUrlSelectedSongIdRef.current = selectedSongIdFromUrl;
			return;
		}

		const index = navIndexBySongId.get(selectedSongIdFromUrl);
		if (index == null) return;

		prevUrlSelectedSongIdRef.current = selectedSongIdFromUrl;
		hasSyncedInitialUrlSelectionRef.current = true;

		syncFocusedIndex(index, {
			focus: false,
			source: "url",
		});
	}, [
		navIndexBySongId,
		selectedSongIdFromUrl,
		shouldSyncInitialUrlSelection,
		syncFocusedIndex,
	]);

	const lastScrolledCursorSequenceRef = useRef<number | null>(null);
	useIsomorphicLayoutEffect(() => {
		const change = lastCursorChange;
		if (!change) return;
		if (lastScrolledCursorSequenceRef.current === change.sequence) return;
		lastScrolledCursorSequenceRef.current = change.sequence;

		const element = getElementAtIndex(change.index);
		if (!element) return;

		const queuedBlock = pendingCursorScrollBlocksRef.current.get(
			change.sequence,
		);
		if (queuedBlock !== undefined) {
			pendingCursorScrollBlocksRef.current.delete(change.sequence);
			if (queuedBlock === null) return;

			scrollListElementIntoView(element, queuedBlock);
			return;
		}

		if (
			isExpanded &&
			(change.source === "pointer" || change.source === "panel-nav")
		) {
			return;
		}

		scrollListElementIntoView(
			element,
			change.source === "pointer" ? "nearest" : "center",
		);
	}, [getElementAtIndex, isExpanded, lastCursorChange]);

	const prevSelectedSongIdRef = useRef<string | null>(null);
	useEffect(() => {
		const prev = prevSelectedSongIdRef.current;
		prevSelectedSongIdRef.current = selectedSongId;
		if (prev && !selectedSongId) {
			focusFocusedItem({
				mode: "keyboard",
				scrollBlock: "nearest",
			});
		}
	}, [selectedSongId, focusFocusedItem]);

	useIsomorphicLayoutEffect(() => {
		const pendingSelectionFocus = pendingSelectionFocusRef.current;
		if (!pendingSelectionFocus) return;
		if (
			pendingSelectionFocus.scrollBlock === "start" &&
			selectionMode &&
			showSelectionUI &&
			selectionBarHeight === 0
		) {
			return;
		}

		const index = navIndexBySongId.get(pendingSelectionFocus.songId);
		if (index == null) return;

		pendingSelectionFocusRef.current = null;
		const change = syncFocusedIndex(index, {
			focus: pendingSelectionFocus.mode === "keyboard",
			mode: pendingSelectionFocus.mode,
			source: "programmatic",
		});

		if (change) {
			queueCursorScrollBlock(
				change.sequence,
				pendingSelectionFocus.scrollBlock,
			);
			return;
		}

		const element = getElementAtIndex(index);
		if (!element) return;

		scrollListElementIntoView(element, pendingSelectionFocus.scrollBlock);
	}, [
		getElementAtIndex,
		navIndexBySongId,
		queueCursorScrollBlock,
		selectionBarHeight,
		selectionMode,
		showSelectionUI,
		syncFocusedIndex,
	]);

	const [pendingCenterSongId, setPendingCenterSongId] = useState<string | null>(
		null,
	);

	const centerSongInList = useCallback((songId: string) => {
		setPendingCenterSongId(songId);
	}, []);

	// Center a song the way a deep link does: a "url"-sourced cursor sync feeds the
	// shared scroll effect above, which centers any non-pointer change even while
	// the panel is expanded. Waits until the song exists in the nav index, so a
	// just-unlocked song settles into the middle as its panel opens.
	useIsomorphicLayoutEffect(() => {
		if (!pendingCenterSongId) return;
		const index = navIndexBySongId.get(pendingCenterSongId);
		if (index == null) return;

		setPendingCenterSongId(null);

		const change = syncFocusedIndex(index, { focus: false, source: "url" });
		if (change) return;

		// Already the focused row (sync no-ops) — scroll it into the middle anyway.
		const element = getElementAtIndex(index);
		if (element) scrollListElementIntoView(element, "center");
	}, [
		getElementAtIndex,
		navIndexBySongId,
		pendingCenterSongId,
		syncFocusedIndex,
	]);

	const handleNextSong = useCallback(() => {
		if (!selectedSongId) return;
		const selectedIndex = displayedSongIndexById.get(selectedSongId);
		if (selectedIndex == null) return;
		const nextSong = displayedSongs[selectedIndex + 1];
		if (!nextSong) return;

		syncFocusedIndex(selectedIndex + 1, {
			focus: false,
			source: "panel-nav",
		});
		markRouteSelectionSource("panel-nav");
		handleNext();
		prefetchAdjacentSuggestions(nextSong.track.id);
	}, [
		displayedSongIndexById,
		displayedSongs,
		handleNext,
		markRouteSelectionSource,
		prefetchAdjacentSuggestions,
		selectedSongId,
		syncFocusedIndex,
	]);

	const handlePreviousSong = useCallback(() => {
		if (!selectedSongId) return;
		const selectedIndex = displayedSongIndexById.get(selectedSongId);
		if (selectedIndex == null || selectedIndex === 0) return;
		const previousSong = displayedSongs[selectedIndex - 1];
		if (!previousSong) return;

		syncFocusedIndex(selectedIndex - 1, {
			focus: false,
			source: "panel-nav",
		});
		markRouteSelectionSource("panel-nav");
		handlePrevious();
		prefetchAdjacentSuggestions(previousSong.track.id);
	}, [
		displayedSongIndexById,
		displayedSongs,
		handlePrevious,
		markRouteSelectionSource,
		prefetchAdjacentSuggestions,
		selectedSongId,
		syncFocusedIndex,
	]);

	return {
		state: {
			isLoading,
			displayedSongs,
			displayedSongIndexById,
			visibleSongs,
			hasMore,
			stats,
			selectedSongIdFromUrl,
			focusedIndex,
			navIndexBySongId,
		},
		panel: {
			selectedSong,
			selectedSongId,
			isExpanded,
			containerRef,
			hasNext,
			hasPrevious,
			closingToSongId,
			openSong,
			handleClose,
		},
		actions: {
			handleLoadMore,
			sentinelRef,
			prefetchAdjacentSuggestions,
			getItemProps,
			handleCardClick,
			openFocusedSong,
			exitSelectionMode,
			handleNextSong,
			handlePreviousSong,
			centerSongInList,
		},
	};
}

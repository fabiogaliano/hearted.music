import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { scrollListElementIntoView } from "@/lib/keyboard/listScroll";
import type {
	ListNavigationSource,
	ListScrollBlock,
} from "@/lib/keyboard/types";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import type { LikedSong } from "../types";
import {
	type PendingSelectionFocus,
	useSongActivation,
} from "./useSongActivation";

const useIsomorphicLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface UseLikedSongsListControllerOptions {
	displayedSongs: readonly LikedSong[];
	displayedSongIndexById: ReadonlyMap<string, number>;
	navItems: readonly LikedSong[];
	navIndexBySongId: ReadonlyMap<string, number>;
	selectedSongId: string | null;
	selectedSongIdFromUrl: string | null;
	isExpanded: boolean;
	selectionMode: boolean;
	showSelectionUI: boolean;
	selectionBarHeight: number;
	enterSelectionMode: () => void;
	toggleSongSelection: (songId: string) => void;
	clearSelectionMode: () => void;
	handleExpand: (song: LikedSong, element: HTMLElement) => void;
	handleNext: () => void;
	handlePrevious: () => void;
	prefetchAdjacentSuggestions: (songId: string) => void;
	handleLoadMore: () => void;
	hasMore: boolean;
}

export function useLikedSongsListController({
	displayedSongs,
	displayedSongIndexById,
	navItems,
	navIndexBySongId,
	selectedSongId,
	selectedSongIdFromUrl,
	isExpanded,
	selectionMode,
	showSelectionUI,
	selectionBarHeight,
	enterSelectionMode,
	toggleSongSelection,
	clearSelectionMode,
	handleExpand,
	handleNext,
	handlePrevious,
	prefetchAdjacentSuggestions,
	handleLoadMore,
	hasMore,
}: UseLikedSongsListControllerOptions) {
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

	const { activateSong, handleCardClick } = useSongActivation({
		displayedSongs,
		showSelectionUI,
		selectionMode,
		enterSelectionMode,
		toggleSongSelection,
		handleExpand,
		prefetchAdjacentSuggestions,
		queueSelectionFocus,
		markRouteSelectionSource,
	});

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
			activateSong({
				song,
				element,
				routeSource: "keyboard",
				selectionFocusMode:
					interactionMode === "pointer" ? "pointer" : "keyboard",
			});
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

		const index = navIndexBySongId.get(selectedSongIdFromUrl);
		if (index == null) return;

		prevUrlSelectedSongIdRef.current = selectedSongIdFromUrl;

		syncFocusedIndex(index, {
			focus: false,
			source: "url",
		});
	}, [navIndexBySongId, selectedSongIdFromUrl, syncFocusedIndex]);

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

		scrollListElementIntoView(
			element,
			change.source === "pointer" ? "nearest" : "center",
		);
	}, [getElementAtIndex, lastCursorChange]);

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
		focusedIndex,
		getItemProps,
		handleCardClick,
		openFocusedSong,
		exitSelectionMode,
		handleNextSong,
		handlePreviousSong,
	};
}

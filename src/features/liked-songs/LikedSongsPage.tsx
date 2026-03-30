/**
 * LikedSongsPage - Main page for browsing liked songs
 *
 * Uses FLIP animation pattern for song expansion (like Playlists feature).
 * Clicking a song card morphs it into a full detail overlay.
 *
 * URL Sync: Uses shallow routing (window.history.pushState) for smooth
 * animations without React Router navigation overhead.
 */
import {
	useInfiniteQuery,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { useActiveJobs } from "@/lib/hooks/useActiveJobs";
import { scrollListElementIntoView } from "@/lib/keyboard/listScroll";
import type { ListNavigationSource } from "@/lib/keyboard/types";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { generateSongSlug } from "@/lib/utils/slug";

import { SongCard } from "./components/SongCard";
import { SongDetailPanel } from "./components/SongDetailPanel";
import { useInfiniteScroll } from "./hooks/useInfiniteScroll";
import { useSongExpansion } from "./hooks/useSongExpansion";
import {
	type FilterOption,
	likedSongBySlugQueryOptions,
	likedSongsInfiniteQueryOptions,
	likedSongsStatsQueryOptions,
	songSuggestionsQueryOptions,
} from "./queries";
import type { LikedSong } from "./types";

const useIsomorphicLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface LikedSongsPageProps {
	initialFilter?: FilterOption;
	/** Song slug from URL for deep linking on page load */
	selectedSlug?: string | null;
	/** Use dark mode for detail panel (default: true) */
	isDarkMode?: boolean;
	/** Account ID for query cache isolation */
	accountId: string;
}

function findSongForSlug(
	songs: LikedSong[],
	slug: string | null | undefined,
): LikedSong | null {
	if (!slug) {
		return null;
	}

	return (
		songs.find(
			(candidate) =>
				generateSongSlug(candidate.track.artist, candidate.track.name) === slug,
		) ?? null
	);
}

export function LikedSongsPage({
	initialFilter = "all",
	selectedSlug,
	isDarkMode: initialDarkMode = true,
	accountId,
}: LikedSongsPageProps) {
	const theme = useTheme();
	const { isEnrichmentRunning } = useActiveJobs(accountId);
	const [isDarkMode, setIsDarkMode] = useState(initialDarkMode);

	useShortcut({
		key: "mod+d",
		handler: () => setIsDarkMode((prev) => !prev),
		description: "Toggle dark mode",
		scope: "liked-list",
		category: "actions",
	});

	const filter = initialFilter;

	const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
		useInfiniteQuery(likedSongsInfiniteQueryOptions(filter));

	const songs = useMemo(
		() => data?.pages.flatMap((p) => p.songs) ?? [],
		[data?.pages],
	);

	const displayedSongs = songs;
	const hasMore = hasNextPage ?? false;
	const selectedSongFromLoadedPages = useMemo(
		() => findSongForSlug(displayedSongs, selectedSlug),
		[displayedSongs, selectedSlug],
	);
	const shouldFetchSelectedSongBySlug =
		selectedSlug != null && selectedSongFromLoadedPages === null;
	const {
		data: selectedSongFromSlugLookup,
		isPending: isSelectedSongSlugLookupPending,
	} = useQuery({
		...likedSongBySlugQueryOptions(accountId, selectedSlug),
		enabled: shouldFetchSelectedSongBySlug,
	});
	const selectedSongFromUrl =
		selectedSongFromLoadedPages ?? selectedSongFromSlugLookup ?? null;
	const isSelectedSlugResolved =
		selectedSlug == null ||
		selectedSongFromLoadedPages !== null ||
		!shouldFetchSelectedSongBySlug ||
		!isSelectedSongSlugLookupPending;

	const handleLoadMore = useCallback(() => {
		if (!isFetchingNextPage && hasNextPage) {
			fetchNextPage();
		}
	}, [fetchNextPage, hasNextPage, isFetchingNextPage]);

	// Infinite scroll hook - triggers load when sentinel enters viewport
	const { sentinelRef } = useInfiniteScroll({
		onLoadMore: handleLoadMore,
		hasMore,
	});

	// FLIP expansion hook with shallow URL routing
	const {
		selectedSong,
		selectedSongId,
		isExpanded,
		startRect,
		containerRef,
		hasNext,
		hasPrevious,
		handleExpand,
		handleNext,
		handlePrevious,
		handleClose,
		closingToSongId,
	} = useSongExpansion(displayedSongs, {
		selectedSlug,
		fallbackSelectedSong: selectedSongFromUrl,
		isSelectedSlugResolved,
	});

	const queryClient = useQueryClient();

	const prefetchAdjacentSuggestions = useCallback(
		(songIndex: number) => {
			const adjacent = [
				displayedSongs[songIndex + 1]?.track.id,
				displayedSongs[songIndex - 1]?.track.id,
			].filter((id): id is string => id != null);

			for (const id of adjacent) {
				queryClient.prefetchQuery(songSuggestionsQueryOptions(id));
			}
		},
		[queryClient, displayedSongs],
	);

	const artistImageUrl = selectedSong?.track.artist_image_url ?? undefined;
	const selectedSongIdFromUrl = selectedSongFromUrl?.track.id ?? null;
	const prevUrlSelectedSongIdRef = useRef<string | null>(null);
	const pendingRouteSelectionSourceRef = useRef<ListNavigationSource | null>(
		null,
	);

	const { data: stats } = useQuery({
		...likedSongsStatsQueryOptions(accountId),
		refetchInterval: isEnrichmentRunning ? 5_000 : undefined,
	});

	const {
		focusedIndex,
		lastCursorChange,
		syncFocusedIndex,
		getFocusedElement,
		getElementAtIndex,
		focusFocusedItem,
		getItemProps,
	} = useListNavigation<LikedSong>({
		items: displayedSongs,
		scope: "liked-list",
		enabled: !isExpanded && displayedSongs.length > 0,
		onSelect: (song, index, element) => {
			if (!element) return;
			pendingRouteSelectionSourceRef.current = "keyboard";
			handleExpand(song, element);
			prefetchAdjacentSuggestions(index);
		},
		getId: (song) => song.track.id,
		onLoadMore: handleLoadMore,
		hasMore,
		scrollBlock: "center",
		autoScroll: false,
	});

	useShortcut({
		key: "enter",
		handler: () => {
			if (focusedIndex < 0 || focusedIndex >= displayedSongs.length) return;

			const song = displayedSongs[focusedIndex];
			const element = getFocusedElement();
			if (!element) return;

			pendingRouteSelectionSourceRef.current = "keyboard";
			handleExpand(song, element);
			prefetchAdjacentSuggestions(focusedIndex);
		},
		description: "Open song details",
		scope: "liked-list",
		category: "actions",
		enabled: !isExpanded && focusedIndex >= 0,
	});

	useEffect(() => {
		const prev = prevUrlSelectedSongIdRef.current;
		prevUrlSelectedSongIdRef.current = selectedSongIdFromUrl;

		if (!selectedSongIdFromUrl || selectedSongIdFromUrl === prev) return;

		if (pendingRouteSelectionSourceRef.current !== null) {
			pendingRouteSelectionSourceRef.current = null;
			return;
		}

		const index = displayedSongs.findIndex(
			(song) => song.track.id === selectedSongIdFromUrl,
		);
		if (index < 0) return;

		syncFocusedIndex(index, {
			focus: false,
			source: "url",
		});
	}, [displayedSongs, selectedSongIdFromUrl, syncFocusedIndex]);

	useIsomorphicLayoutEffect(() => {
		const change = lastCursorChange;
		if (!change) return;

		const element = getElementAtIndex(change.index);
		if (!element) return;

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
			focusFocusedItem({ mode: "keyboard" });
		}
	}, [selectedSongId, focusFocusedItem]);

	const handlePointerExpand = useCallback(
		(song: LikedSong, element: HTMLElement) => {
			pendingRouteSelectionSourceRef.current = "pointer";
			handleExpand(song, element);
			const idx = displayedSongs.findIndex((s) => s.track.id === song.track.id);
			if (idx >= 0) prefetchAdjacentSuggestions(idx);
		},
		[handleExpand, displayedSongs, prefetchAdjacentSuggestions],
	);

	const handleNextSong = useCallback(() => {
		const selectedIndex = displayedSongs.findIndex(
			(song) => song.track.id === selectedSongId,
		);
		const nextSong =
			selectedIndex >= 0 ? displayedSongs[selectedIndex + 1] : undefined;
		if (!nextSong) return;

		syncFocusedIndex(selectedIndex + 1, {
			focus: false,
			source: "panel-nav",
		});
		pendingRouteSelectionSourceRef.current = "panel-nav";
		handleNext();
		prefetchAdjacentSuggestions(selectedIndex + 1);
	}, [
		displayedSongs,
		handleNext,
		selectedSongId,
		syncFocusedIndex,
		prefetchAdjacentSuggestions,
	]);

	const handlePreviousSong = useCallback(() => {
		const selectedIndex = displayedSongs.findIndex(
			(song) => song.track.id === selectedSongId,
		);
		const previousSong =
			selectedIndex > 0 ? displayedSongs[selectedIndex - 1] : undefined;
		if (!previousSong) return;

		syncFocusedIndex(selectedIndex - 1, {
			focus: false,
			source: "panel-nav",
		});
		pendingRouteSelectionSourceRef.current = "panel-nav";
		handlePrevious();
		prefetchAdjacentSuggestions(selectedIndex - 1);
	}, [
		displayedSongs,
		handlePrevious,
		selectedSongId,
		syncFocusedIndex,
		prefetchAdjacentSuggestions,
	]);

	return (
		<div ref={containerRef} className="relative min-h-[600px] max-w-5xl">
			{/* Header */}
			<div className="mb-8">
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Your Music
				</p>
				<h1
					className="mt-3 text-5xl font-extralight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					Liked Songs
				</h1>

				{/* Stats row */}
				<div className="mt-6 flex items-baseline gap-6">
					<span
						className="text-3xl font-extralight tabular-nums"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						{stats?.success ? stats.total : "—"}
					</span>
					<span
						className="text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						songs
					</span>
					<span
						className="text-sm"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						·
					</span>
					<span
						className="text-sm tabular-nums"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{stats?.success ? stats.analyzed : "—"} analyzed
					</span>
					<span
						className="text-sm"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						·
					</span>
					<span
						className="text-sm tabular-nums"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{stats?.success ? stats.pending : "—"} pending
					</span>
				</div>
			</div>

			{/* Song list */}
			<div className="border-t pt-6" style={{ borderColor: theme.border }}>
				{isLoading ? (
					<div className="py-12 text-center">
						<p
							className="text-sm"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							Loading your liked songs...
						</p>
					</div>
				) : displayedSongs.length === 0 ? (
					<div className="py-12 text-center">
						<p
							className="text-sm"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							{filter === "all"
								? "No liked songs yet. Like songs on Spotify to see them here."
								: `No ${filter} songs.`}
						</p>
					</div>
				) : (
					<div className="space-y-1">
						{displayedSongs.map((song, index) => {
							const itemProps = getItemProps(song, index);
							return (
								<SongCard
									key={song.track.id}
									song={song}
									albumArtUrl={song.track.image_url ?? undefined}
									isSelected={selectedSongId === song.track.id}
									isFocused={itemProps["data-focused"]}
									itemRef={itemProps.ref}
									tabIndex={itemProps.tabIndex}
									dataFocused={itemProps["data-focused"]}
									navEngaged={itemProps["data-nav-engaged"]}
									onPointerDown={itemProps.onPointerDown}
									onFocus={itemProps.onFocus}
									onBlur={itemProps.onBlur}
									onClick={(e) => handlePointerExpand(song, e.currentTarget)}
									isAnimatingTo={closingToSongId === song.track.id}
								/>
							);
						})}

						{/* Infinite scroll sentinel */}
						{hasMore && (
							<div
								ref={sentinelRef}
								className="flex items-center justify-center py-8"
							>
								<span
									className="text-xs tracking-widest uppercase"
									style={{ fontFamily: fonts.body, color: theme.textMuted }}
								>
									Loading more...
								</span>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Detail View Overlay */}
			{selectedSong && (
				<SongDetailPanel
					song={selectedSong}
					albumArtUrl={selectedSong.track.image_url ?? undefined}
					artistImageUrl={artistImageUrl}
					isExpanded={isExpanded}
					startRect={startRect}
					hasNext={hasNext}
					hasPrevious={hasPrevious}
					onClose={handleClose}
					onNext={handleNextSong}
					onPrevious={handlePreviousSong}
					isDark={isDarkMode}
					isEnrichmentRunning={isEnrichmentRunning}
				/>
			)}

			{/* Dark mode toggle indicator */}
			{!isExpanded && (
				<button
					type="button"
					className="fixed right-6 bottom-6 z-40 cursor-pointer rounded-full px-3 py-2 backdrop-blur-md transition-transform hover:scale-105"
					style={{
						background: `${theme.surface}ee`,
						border: `1px solid ${theme.border}`,
					}}
					onClick={() => setIsDarkMode((prev) => !prev)}
					aria-label="Toggle dark mode"
					title="Toggle dark mode (⌘D)"
				>
					<span
						className="text-[10px] tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{isDarkMode ? "Dark" : "Light"}
					</span>
				</button>
			)}
		</div>
	);
}

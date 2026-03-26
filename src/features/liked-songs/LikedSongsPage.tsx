/**
 * LikedSongsPage - Main page for browsing liked songs
 *
 * Uses FLIP animation pattern for song expansion (like Playlists feature).
 * Clicking a song card morphs it into a full detail overlay.
 *
 * URL Sync: Uses shallow routing (window.history.pushState) for smooth
 * animations without React Router navigation overhead.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { useActiveJobs } from "@/lib/hooks/useActiveJobs";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

import { SongCard } from "./components/SongCard";
import { SongDetailPanel } from "./components/SongDetailPanel";
import { useInfiniteScroll } from "./hooks/useInfiniteScroll";
import { useSongExpansion } from "./hooks/useSongExpansion";
import {
	type FilterOption,
	likedSongsInfiniteQueryOptions,
	likedSongsStatsQueryOptions,
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
		initialSlug: selectedSlug,
	});

	const artistImageUrl = selectedSong?.track.artist_image_url ?? undefined;

	const { data: stats } = useQuery({
		...likedSongsStatsQueryOptions(accountId),
		refetchInterval: isEnrichmentRunning ? 5_000 : undefined,
	});

	// Keyboard list navigation using centralized shortcut system
	const {
		focusedIndex,
		syncFocusedIndex,
		getFocusedElement,
		focusFocusedItem,
		getItemProps,
	} = useListNavigation<LikedSong>({
		items: displayedSongs,
		scope: "liked-list",
		enabled: !isExpanded && displayedSongs.length > 0,
		onSelect: (song, _index, element) => {
			if (element) {
				handleExpand(song, {
					currentTarget: element,
				} as React.MouseEvent<HTMLElement>);
			}
		},
		getId: (song) => song.track.id,
		onLoadMore: handleLoadMore,
		hasMore,
		scrollBlock: "center",
	});

	// Enter to select focused song (useListNavigation only binds Space by default)
	useShortcut({
		key: "enter",
		handler: () => {
			if (focusedIndex >= 0 && focusedIndex < displayedSongs.length) {
				const song = displayedSongs[focusedIndex];
				const element = getFocusedElement();
				if (element) {
					handleExpand(song, {
						currentTarget: element,
					} as React.MouseEvent<HTMLElement>);
				}
			}
		},
		description: "Open song details",
		scope: "liked-list",
		category: "actions",
		enabled: !isExpanded && focusedIndex >= 0,
	});

	// Sync focus with selected song - keeps list focus indicator aligned with panel
	// This runs when:
	// - Panel opens (focus moves to clicked song)
	// - j/k navigation in panel (focus follows to new song)
	// - Panel closes (focus stays on last viewed song)
	useIsomorphicLayoutEffect(() => {
		if (selectedSongId) {
			const index = displayedSongs.findIndex(
				(s) => s.track.id === selectedSongId,
			);
			if (index >= 0) {
				syncFocusedIndex(index, { focus: false, scroll: true });
			}
		}
	}, [selectedSongId, displayedSongs, syncFocusedIndex]);

	// After the panel fully closes (selectedSongId cleared), restore focus to the current cursor item
	// and engage list navigation visuals (no native outline flicker).
	const prevSelectedSongIdRef = useRef<string | null>(null);
	useEffect(() => {
		const prev = prevSelectedSongIdRef.current;
		prevSelectedSongIdRef.current = selectedSongId;
		if (prev && !selectedSongId) {
			focusFocusedItem({ engage: true });
		}
	}, [selectedSongId, focusFocusedItem]);

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
									onClick={(e) => handleExpand(song, e)}
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
					onNext={handleNext}
					onPrevious={handlePrevious}
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

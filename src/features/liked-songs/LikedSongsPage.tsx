/**
 * Component: LikedSongsPage
 *
 * Main page for browsing liked songs with:
 * - Filter tabs: All, Unsorted, Sorted, Analyzed
 * - Infinite scroll loading (10 initial, more on scroll)
 * - Song expansion with View Transitions
 * - Keyboard navigation (j/k)
 */
import { useCallback, useMemo, useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/useTheme";
import { DEFAULT_THEME } from "@/lib/theme/types";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import type { FilterOption, LikedSong, LikedSongsPageProps } from "./types";
import { useInfiniteScroll } from "./hooks/useInfiniteScroll";
import { useSongExpansion } from "./hooks/useSongExpansion";
import { useVisibleSongsAlbumArt } from "./hooks/useVisibleSongsAlbumArt";
import { SongCard } from "./components/SongCard";
import { SongDetailPanel } from "./components/SongDetailPanel";

const INITIAL_DISPLAY_COUNT = 10;
const LOAD_MORE_COUNT = 10;

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "unsorted", label: "Unsorted" },
	{ value: "sorted", label: "Sorted" },
	{ value: "analyzed", label: "Analyzed" },
];

function EmptyState({
	filter,
	theme,
}: {
	filter: FilterOption;
	theme: ReturnType<typeof useTheme>["theme"];
}) {
	const messages: Record<FilterOption, { title: string; description: string }> =
		{
			all: {
				title: "No liked songs yet",
				description: "Songs you heart on Spotify will appear here",
			},
			unsorted: {
				title: "All sorted!",
				description: "You've sorted all your liked songs into playlists",
			},
			sorted: {
				title: "No sorted songs",
				description: "Songs you add to playlists will appear here",
			},
			analyzed: {
				title: "No analyzed songs",
				description: "We'll analyze your songs to help match them to playlists",
			},
		};

	const { title, description } = messages[filter];

	return (
		<div className="flex flex-col items-center justify-center py-24">
			<h3
				className="text-xl"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				{title}
			</h3>
			<p
				className="mt-2 text-sm"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				{description}
			</p>
		</div>
	);
}

function SkeletonCard({
	theme,
}: {
	theme: ReturnType<typeof useTheme>["theme"];
}) {
	return (
		<div className="flex items-center gap-4 py-4">
			<div
				className="h-12 w-12 flex-shrink-0 animate-pulse"
				style={{ background: theme.surfaceDim }}
			/>
			<div className="flex-1 space-y-2">
				<div
					className="h-4 w-2/3 animate-pulse"
					style={{ background: theme.surfaceDim }}
				/>
				<div
					className="h-3 w-1/2 animate-pulse"
					style={{ background: theme.border }}
				/>
			</div>
		</div>
	);
}

export function LikedSongsPage({
	songs,
	initialFilter,
	selectedSlug,
}: LikedSongsPageProps) {
	const { theme } = useTheme(DEFAULT_THEME);
	const [displayCount, setDisplayCount] = useState(INITIAL_DISPLAY_COUNT);

	const displayedSongs = useMemo(
		() => songs.slice(0, displayCount),
		[songs, displayCount],
	);

	const hasMore = displayCount < songs.length;

	const loadMore = useCallback(() => {
		if (hasMore) {
			setDisplayCount((prev) => Math.min(prev + LOAD_MORE_COUNT, songs.length));
		}
	}, [hasMore, songs.length]);

	const { sentinelRef } = useInfiniteScroll({
		onLoadMore: loadMore,
		hasMore,
	});

	const {
		selectedSong,
		selectedSongId,
		isExpanded,
		startRect,
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

	const { getAlbumArt } = useVisibleSongsAlbumArt(displayedSongs);

	const { focusedIndex, getItemProps, setFocusedIndex } = useListNavigation({
		items: displayedSongs,
		scope: "liked-list",
		enabled: !isExpanded,
		getId: (song) => song.track.id,
		onLoadMore: loadMore,
		hasMore,
		direction: "vertical",
	});

	useShortcut({
		key: "enter",
		handler: () => {
			if (focusedIndex >= 0 && focusedIndex < displayedSongs.length) {
				const song = displayedSongs[focusedIndex];
				const mockEvent = {
					currentTarget: document.querySelector(
						`[data-song-id="${song.track.id}"]`,
					),
				} as unknown as React.MouseEvent<HTMLElement>;
				handleExpand(song, mockEvent);
			}
		},
		description: "Open song details",
		scope: "liked-list",
		category: "actions",
		enabled: !isExpanded && focusedIndex >= 0,
	});

	const handleFilterChange = useCallback(
		(filter: FilterOption) => {
			setDisplayCount(INITIAL_DISPLAY_COUNT);
			setFocusedIndex(-1);
			window.location.href = `/dashboard/liked-songs?filter=${filter}`;
		},
		[setFocusedIndex],
	);

	const handleCardClick = useCallback(
		(song: LikedSong, e: React.MouseEvent<HTMLButtonElement>) => {
			handleExpand(song, e as unknown as React.MouseEvent<HTMLElement>);
		},
		[handleExpand],
	);

	return (
		<div
			className="min-h-screen"
			style={{ background: theme.bg, color: theme.text }}
		>
			<div className="mx-auto max-w-2xl px-6 py-8 lg:px-8">
				<header className="mb-8">
					<h1
						className="text-3xl lg:text-4xl"
						style={{ fontFamily: fonts.display }}
					>
						Liked Songs
					</h1>
					<p
						className="mt-2"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{songs.length} songs in your library
					</p>

					<div className="mt-6 flex gap-1" role="tablist">
						{FILTER_OPTIONS.map((option) => (
							<button
								type="button"
								key={option.value}
								onClick={() => handleFilterChange(option.value)}
								role="tab"
								aria-selected={initialFilter === option.value}
								className="px-4 py-2 text-sm transition-all"
								style={{
									fontFamily: fonts.body,
									background:
										initialFilter === option.value
											? theme.surface
											: "transparent",
									color:
										initialFilter === option.value
											? theme.text
											: theme.textMuted,
								}}
							>
								{option.label}
							</button>
						))}
					</div>
				</header>

				{displayedSongs.length === 0 ? (
					<EmptyState filter={initialFilter} theme={theme} />
				) : (
					<section>
						<div className="divide-y" style={{ borderColor: theme.border }}>
							{displayedSongs.map((song, index) => {
								const itemProps = getItemProps(song, index);
								const albumArtUrl =
									song.track.image_url || getAlbumArt(song.track.spotify_id);
								const isSelected = selectedSongId === song.track.id;
								const isAnimatingTo = closingToSongId === song.track.id;

								return (
									<div
										key={song.id}
										{...itemProps}
										data-song-id={song.track.id}
										style={{ borderColor: theme.border }}
									>
										<SongCard
											song={song}
											albumArtUrl={albumArtUrl}
											isSelected={isSelected}
											isFocused={focusedIndex === index}
											onClick={(e) => handleCardClick(song, e)}
											isAnimatingTo={isAnimatingTo}
										/>
									</div>
								);
							})}
						</div>

						{hasMore && (
							<div ref={sentinelRef} className="py-4">
								<SkeletonCard theme={theme} />
								<SkeletonCard theme={theme} />
							</div>
						)}
					</section>
				)}
			</div>

			{selectedSong && (
				<SongDetailPanel
					song={selectedSong}
					albumArtUrl={
						selectedSong.track.image_url ||
						getAlbumArt(selectedSong.track.spotify_id)
					}
					isExpanded={isExpanded}
					startRect={startRect}
					onClose={handleClose}
					onNext={handleNext}
					onPrevious={handlePrevious}
					hasNext={hasNext}
					hasPrevious={hasPrevious}
				/>
			)}
		</div>
	);
}

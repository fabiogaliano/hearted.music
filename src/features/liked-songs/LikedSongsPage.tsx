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

import { PaywallCTA } from "@/features/billing/components/PaywallCTA";
import type {
	OnboardingSession,
	WalkthroughSong,
} from "@/features/onboarding/step-resolver";
import type { BillingState } from "@/lib/domains/billing/state";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
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
import { SongSelectionBar } from "./components/SongSelectionBar";
import { UnlockConfirmDialog } from "./components/UnlockConfirmDialog";
import { useInfiniteScroll } from "./hooks/useInfiniteScroll";
import { useSongExpansion } from "./hooks/useSongExpansion";
import { useSongUnlock } from "./hooks/useSongUnlock";
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
	/** Billing state for song unlock selection UI (pack users only) */
	billingState?: BillingState;
	/**
	 * Onboarding session from route context. The `song-walkthrough` variant
	 * carries its demo song inline via the discriminated union, so no separate
	 * `walkthroughSong` prop is needed.
	 */
	onboardingSession?: OnboardingSession;
}

function buildSyntheticLikedSong(ws: WalkthroughSong): LikedSong {
	return {
		liked_at: new Date().toISOString(),
		matching_status: null,
		displayState: "analyzed",
		analysis: ws.analysis
			? {
					id: ws.analysis.id,
					track_id: ws.id,
					analysis: ws.analysis.content,
					model_name: ws.analysis.model,
					version: 1,
					created_at: ws.analysis.createdAt,
				}
			: null,
		track: {
			id: ws.id,
			spotify_track_id: ws.spotifyTrackId,
			name: ws.name,
			artist: ws.artist,
			artist_id: ws.artistId,
			artist_image_url: ws.artistImageUrl,
			album: ws.album,
			image_url: ws.albumArtUrl,
			genres: ws.genres,
			audio_features: null,
		},
	};
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
	billingState,
	onboardingSession,
}: LikedSongsPageProps) {
	const theme = useTheme();
	const { isEnrichmentRunning } = useActiveJobs(accountId);
	const [isDarkMode, setIsDarkMode] = useState(initialDarkMode);
	const walkthroughSong: WalkthroughSong | null =
		onboardingSession?.status === "song-walkthrough"
			? onboardingSession.song
			: null;
	const isWalkthrough = walkthroughSong !== null;

	const showSelectionUI =
		!isWalkthrough &&
		billingState != null &&
		!hasUnlimitedAccess(billingState) &&
		billingState.creditBalance > 0;

	const showPaywall =
		!isWalkthrough &&
		billingState != null &&
		!hasUnlimitedAccess(billingState) &&
		billingState.creditBalance === 0;

	const [selectionMode, setSelectionMode] = useState(false);
	const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(
		new Set(),
	);

	const toggleSongSelection = useCallback((songId: string) => {
		setSelectedSongIds((prev) => {
			const next = new Set(prev);
			if (next.has(songId)) {
				next.delete(songId);
			} else {
				next.add(songId);
			}
			return next;
		});
	}, []);

	const exitSelectionMode = useCallback(() => {
		setSelectionMode(false);
		setSelectedSongIds(new Set());
	}, []);

	const {
		flowState,
		requestConfirmation,
		cancelConfirmation,
		confirmUnlock,
		dismiss: dismissFlow,
	} = useSongUnlock(accountId);

	const handleUnlockConfirm = useCallback(() => {
		if (selectedSongIds.size === 0) return;
		requestConfirmation(Array.from(selectedSongIds));
	}, [selectedSongIds, requestConfirmation]);

	const handleFlowDismiss = useCallback(() => {
		dismissFlow();
		if (flowState.step === "success") {
			exitSelectionMode();
		}
	}, [dismissFlow, flowState.step, exitSelectionMode]);

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

	const displayedSongs = useMemo(() => {
		if (!isWalkthrough || !walkthroughSong) return songs;
		const realSong = songs.find((s) => s.track.id === walkthroughSong.id);
		const synthetic = buildSyntheticLikedSong(walkthroughSong);
		const demoSong: LikedSong = realSong
			? {
					...realSong,
					displayState: "analyzed",
					analysis: realSong.analysis ?? synthetic.analysis,
				}
			: synthetic;
		const deduped = songs.filter((s) => s.track.id !== walkthroughSong.id);
		return [demoSong, ...deduped];
	}, [songs, isWalkthrough, walkthroughSong]);

	const visibleSongs = useMemo(
		() =>
			selectionMode && showSelectionUI
				? displayedSongs.filter((s) => s.displayState === "locked")
				: displayedSongs,
		[displayedSongs, selectionMode, showSelectionUI],
	);

	const hasMore = isWalkthrough ? false : (hasNextPage ?? false);
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
		(songId: string) => {
			const songIndex = displayedSongs.findIndex((s) => s.track.id === songId);
			if (songIndex < 0) return;

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

	const navItems = useMemo(
		() =>
			isWalkthrough && walkthroughSong
				? displayedSongs.filter((s) => s.track.id === walkthroughSong.id)
				: visibleSongs,
		[displayedSongs, visibleSongs, isWalkthrough, walkthroughSong],
	);

	const {
		focusedIndex,
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
		onSelect: (song, _index, element) => {
			if (!element) return;
			pendingRouteSelectionSourceRef.current = "keyboard";
			handleExpand(song, element);
			prefetchAdjacentSuggestions(song.track.id);
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
			if (focusedIndex < 0 || focusedIndex >= navItems.length) return;

			const song = navItems[focusedIndex];
			const element = getFocusedElement();
			if (!element) return;

			pendingRouteSelectionSourceRef.current = "keyboard";
			handleExpand(song, element);
			prefetchAdjacentSuggestions(song.track.id);
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

		const index = navItems.findIndex(
			(song) => song.track.id === selectedSongIdFromUrl,
		);
		if (index < 0) return;

		syncFocusedIndex(index, {
			focus: false,
			source: "url",
		});
	}, [navItems, selectedSongIdFromUrl, syncFocusedIndex]);

	const lastScrolledCursorSequenceRef = useRef<number | null>(null);
	useIsomorphicLayoutEffect(() => {
		const change = lastCursorChange;
		if (!change) return;
		// Only scroll for a new cursor change. Dependency identity churn
		// (e.g. mode toggle rebuilding navItems / getElementAtIndex) must not
		// re-trigger a stale scroll.
		if (lastScrolledCursorSequenceRef.current === change.sequence) return;
		lastScrolledCursorSequenceRef.current = change.sequence;

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
			prefetchAdjacentSuggestions(song.track.id);
		},
		[handleExpand, prefetchAdjacentSuggestions],
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
		prefetchAdjacentSuggestions(nextSong.track.id);
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
		prefetchAdjacentSuggestions(previousSong.track.id);
	}, [
		displayedSongs,
		handlePrevious,
		selectedSongId,
		syncFocusedIndex,
		prefetchAdjacentSuggestions,
	]);

	const noopItemRef = useCallback(() => {}, []);

	return (
		<div ref={containerRef} className="relative min-h-150 max-w-5xl">
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
					{stats?.success && stats.locked > 0 && (
						<>
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
								{stats.locked} locked
							</span>
						</>
					)}
					{showSelectionUI &&
						stats?.success &&
						stats.locked > 0 &&
						!selectionMode && (
							<button
								type="button"
								onClick={() => setSelectionMode(true)}
								className="cursor-pointer rounded-full border px-3 py-1 text-xs tracking-wide uppercase transition-opacity hover:opacity-80"
								style={{
									fontFamily: fonts.body,
									borderColor: theme.border,
									color: theme.text,
									background: "transparent",
								}}
							>
								Unlock Songs
							</button>
						)}
				</div>
			</div>

			{/* Selection bar for pack users — sticky below header */}
			{selectionMode && showSelectionUI && billingState && (
				<SongSelectionBar
					selectedCount={selectedSongIds.size}
					remainingBalance={billingState.creditBalance}
					onConfirm={handleUnlockConfirm}
					onCancel={exitSelectionMode}
				/>
			)}

			{/* Zero-balance paywall CTA */}
			{showPaywall && billingState && (
				<div
					className="mb-6 rounded-xl px-6 py-4"
					style={{
						background: theme.surfaceDim,
						border: `1px solid ${theme.border}`,
					}}
				>
					<PaywallCTA billingState={billingState} />
				</div>
			)}

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
						{visibleSongs.length === 0 && selectionMode && showSelectionUI && (
							<div className="py-12 text-center">
								<p
									className="text-sm"
									style={{ fontFamily: fonts.body, color: theme.textMuted }}
								>
									No locked songs available to unlock.
								</p>
							</div>
						)}
						{visibleSongs.map((song) => {
							const isDemoSong =
								isWalkthrough &&
								walkthroughSong &&
								song.track.id === walkthroughSong.id;
							const isSongEnabled = !isWalkthrough || !!isDemoSong;
							const navIndex = isSongEnabled
								? navItems.findIndex((s) => s.track.id === song.track.id)
								: -1;
							const itemProps =
								navIndex >= 0 ? getItemProps(song, navIndex) : null;
							return (
								<SongCard
									key={song.track.id}
									song={song}
									albumArtUrl={song.track.image_url ?? undefined}
									isSelected={selectedSongId === song.track.id}
									isFocused={itemProps?.["data-focused"] ?? false}
									itemRef={itemProps?.ref ?? noopItemRef}
									tabIndex={itemProps?.tabIndex ?? -1}
									dataFocused={itemProps?.["data-focused"] ?? false}
									navEngaged={itemProps?.["data-nav-engaged"] ?? false}
									onPointerDown={itemProps?.onPointerDown}
									onFocus={itemProps?.onFocus}
									onBlur={itemProps?.onBlur}
									onClick={(e) => {
										if (!isSongEnabled) return;
										if (
											song.displayState === "locked" &&
											showSelectionUI &&
											!selectionMode
										) {
											setSelectionMode(true);
											toggleSongSelection(song.track.id);
											return;
										}
										handlePointerExpand(song, e.currentTarget);
									}}
									isAnimatingTo={closingToSongId === song.track.id}
									selectionMode={selectionMode && showSelectionUI}
									isChecked={selectedSongIds.has(song.track.id)}
									onToggleSelect={toggleSongSelection}
									isEnabled={isSongEnabled}
									isWalkthroughHighlight={!!isDemoSong && !isExpanded}
									hideLockedBadge={isWalkthrough}
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
					hasNext={isWalkthrough ? false : hasNext}
					hasPrevious={isWalkthrough ? false : hasPrevious}
					onClose={handleClose}
					onNext={handleNextSong}
					onPrevious={handlePreviousSong}
					isDark={isDarkMode}
					isEnrichmentRunning={isWalkthrough ? false : isEnrichmentRunning}
					isWalkthrough={isWalkthrough}
				/>
			)}

			{/* Unlock confirmation / progress / error dialog */}
			{flowState.step !== "idle" && billingState && (
				<UnlockConfirmDialog
					flowState={flowState}
					remainingBalance={billingState.creditBalance}
					billingState={billingState}
					onConfirm={confirmUnlock}
					onCancel={cancelConfirmation}
					onDismiss={handleFlowDismiss}
				/>
			)}

			{/* Dark mode toggle indicator */}
			{!isExpanded && !selectionMode && (
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

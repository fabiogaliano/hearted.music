import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PaywallCTA } from "@/features/billing/components/PaywallCTA";
import type { BillingState } from "@/lib/domains/billing/state";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import type {
	OnboardingSession,
	WalkthroughSong,
} from "@/lib/domains/library/accounts/onboarding-session";
import { useActiveJobs } from "@/lib/hooks/useActiveJobs";
import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { useAuthenticatedTheme } from "@/lib/theme/authenticated-theme";
import { LikedSongsHeader } from "./components/LikedSongsHeader";
import { LikedSongsList } from "./components/LikedSongsList";
import { SongSelectionBar } from "./components/SongSelectionBar";
import {
	PANEL_WIDTH,
	SongDetailPanel,
} from "./components/song-detail-panel/SongDetailPanel";
import type { LockedCta } from "./components/song-detail-panel/SongDetailPanelSurface";
import { likedSongToSongDetail } from "./components/song-detail-panel/song-detail-adapter";
import { UnlockConfirmDialog } from "./components/UnlockConfirmDialog";
import type { SearchFilter } from "./filter";
import { toQueryFilter } from "./filter";
import { useLikedSongsListController } from "./hooks/useLikedSongsListController";
import { useLikedSongsListModel } from "./hooks/useLikedSongsListModel";
import { useLikedSongsPageData } from "./hooks/useLikedSongsPageData";
import { useSongExpansion } from "./hooks/useSongExpansion";
import { useSongPlaylistSuggestions } from "./hooks/useSongPlaylistSuggestions";
import { useSongUnlock } from "./hooks/useSongUnlock";
import { clearLikedSongsPageLive, markLikedSongsPageLive } from "./queries";

const LIST_TOP_GAP_PX = 24;
const SEARCH_DEBOUNCE_MS = 250;

interface LikedSongsPageProps {
	filter?: SearchFilter;
	onFilterChange?: (filter: SearchFilter) => void;
	selectedSlug?: string | null;
	accountId: string;
	billingState?: BillingState;
	onboardingSession?: OnboardingSession;
}

export function LikedSongsPage({
	filter = "all",
	onFilterChange,
	selectedSlug,
	accountId,
	billingState,
	onboardingSession,
}: LikedSongsPageProps) {
	const queryClient = useQueryClient();
	const { isEnrichmentRunning } = useActiveJobs(accountId);
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
	const [searchQuery, setSearchQuery] = useState("");
	const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
	const selectionBarRef = useRef<HTMLDivElement | null>(null);
	const [selectionBarHeight, setSelectionBarHeight] = useState<number>(0);

	useEffect(() => {
		markLikedSongsPageLive(queryClient);
		return () => {
			clearLikedSongsPageLive(queryClient);
		};
	}, [queryClient]);

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

	const clearSelectionMode = useCallback(() => {
		setSelectionMode(false);
		setSelectedSongIds(new Set());
	}, []);

	const {
		flowState,
		requestConfirmation,
		cancelConfirmation,
		showPaywall: openPaywall,
		confirmUnlock,
		dismiss: dismissFlow,
	} = useSongUnlock(accountId);

	const queryFilter = toQueryFilter(filter);
	const handleFilterChange = useCallback(
		(next: SearchFilter) => {
			onFilterChange?.(next);
		},
		[onFilterChange],
	);

	useEffect(() => {
		const trimmed = searchQuery.trim();
		if (trimmed === debouncedSearchQuery) return;

		const handle = window.setTimeout(() => {
			setDebouncedSearchQuery(trimmed);
		}, SEARCH_DEBOUNCE_MS);

		return () => window.clearTimeout(handle);
	}, [searchQuery, debouncedSearchQuery]);

	const {
		isLoading,
		displayedSongs,
		displayedSongIndexById,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		selectedSongFromUrl,
		selectedSongIdFromUrl,
		isSelectedSlugResolved,
		stats,
	} = useLikedSongsPageData({
		accountId,
		filter: queryFilter,
		search: debouncedSearchQuery,
		selectedSlug,
		isWalkthrough,
		walkthroughSong,
		isEnrichmentRunning,
	});

	// The song whose panel opens once an unlock succeeds. Derived fresh each
	// confirm from canonical state (sort order + selection), so it never drifts;
	// the null default is what makes the lockedCta path skip the reveal.
	const revealTargetIdRef = useRef<string | null>(null);

	const handleUnlockConfirm = useCallback(() => {
		if (selectedSongIds.size === 0) return;
		const ids = Array.from(selectedSongIds);
		// Reveal the selected song highest in the current sort order — the one the
		// user sees as "the top". Independent of the order rows were clicked.
		revealTargetIdRef.current =
			displayedSongs.find((song) => selectedSongIds.has(song.track.id))?.track
				.id ?? null;
		requestConfirmation(ids);
	}, [selectedSongIds, displayedSongs, requestConfirmation]);

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

	// The song-detail panel reads the persisted v17 SongRead when present. The
	// adapter always returns a SongDetail (read=null for rows that don't parse —
	// locked, not yet analyzed, or pre-v17 8-field), so every selected song opens:
	// the panel renders the hero plus a minimal "not analyzed yet" state for those.
	const { themeColor } = useAuthenticatedTheme();
	const conceptSong = useMemo(
		() =>
			selectedSong ? likedSongToSongDetail(selectedSong, themeColor) : null,
		[selectedSong, themeColor],
	);

	// The locked panel's CTA: entitled accounts can't have a locked song open, so
	// this only resolves for credit/free accounts — unlock straight to the confirm
	// dialog when there's balance, otherwise route to plans. Walkthrough has no
	// billing context, so it stays undefined and the button hides.
	const lockedCta = useMemo<LockedCta | undefined>(() => {
		if (isWalkthrough) return undefined;
		if (!conceptSong || conceptSong.displayState !== "locked") return undefined;
		if (!billingState || hasUnlimitedAccess(billingState)) return undefined;
		return billingState.creditBalance > 0
			? {
					label: "Unlock this song",
					onClick: () => requestConfirmation([conceptSong.id]),
				}
			: { label: "See plans", onClick: openPaywall };
	}, [
		isWalkthrough,
		conceptSong,
		billingState,
		requestConfirmation,
		openPaywall,
	]);

	// Add-to-playlist matches shown at the bottom of an analyzed read. Disabled in
	// walkthrough (no billing/match context); the hook returns undefined when there
	// are no matches, so the panel omits the section. spotifyTrackId drives the
	// optimistic Spotify add before the server-side decision is recorded.
	const playlists = useSongPlaylistSuggestions(
		conceptSong
			? { id: conceptSong.id, spotifyTrackId: conceptSong.spotifyTrackId }
			: null,
		!isWalkthrough,
	);

	const lockedSongCount = stats?.success ? stats.locked : 0;

	const {
		visibleSongs,
		hasMore,
		handleLoadMore,
		sentinelRef,
		prefetchAdjacentSuggestions,
		navItems,
		navIndexBySongId,
	} = useLikedSongsListModel({
		displayedSongs,
		displayedSongIndexById,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		isWalkthrough,
		walkthroughSongId: walkthroughSong?.id ?? null,
		selectionMode,
		showSelectionUI,
		activeFilter: filter,
	});

	const initialSelectedSlugRef = useRef(selectedSlug ?? null);
	const shouldSyncInitialUrlSelection =
		initialSelectedSlugRef.current !== null &&
		selectedSlug === initialSelectedSlugRef.current;
	const isSearching = debouncedSearchQuery.length > 0;

	useIsomorphicLayoutEffect(() => {
		if (!selectionMode || !showSelectionUI) {
			setSelectionBarHeight(0);
			return;
		}

		const bar = selectionBarRef.current;
		if (!bar) return;

		const syncHeight = () => {
			setSelectionBarHeight(bar.getBoundingClientRect().height);
		};

		syncHeight();

		if (typeof ResizeObserver === "undefined") return;

		const observer = new ResizeObserver(() => {
			syncHeight();
		});
		observer.observe(bar);

		return () => {
			observer.disconnect();
		};
	}, [selectionMode, showSelectionUI]);

	const selectionModeScrollMarginTop =
		selectionMode && showSelectionUI && selectionBarHeight > 0
			? `${selectionBarHeight + LIST_TOP_GAP_PX}px`
			: undefined;

	const enterSelectionMode = useCallback(() => setSelectionMode(true), []);

	const {
		focusedIndex,
		handleCardClick,
		openFocusedSong,
		exitSelectionMode,
		handleNextSong,
		handlePreviousSong,
		getItemProps,
		centerSongInList,
	} = useLikedSongsListController({
		displayedSongs,
		displayedSongIndexById,
		navItems,
		navIndexBySongId,
		selectedSongId,
		selectedSongIdFromUrl,
		shouldSyncInitialUrlSelection,
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
	});

	// On a successful unlock, reveal the song captured at confirm (topmost of the
	// selection by sort order): open its panel (deep-link style, no FLIP) and
	// center it in the list. Runs on dismiss, so the panel is already open and
	// centered behind the success card before it fades. The lockedCta path already
	// has the song's panel open, so it skips this (its targetId stays null).
	const handleFlowDismiss = useCallback(() => {
		const wasSuccess = flowState.step === "success";
		const targetId = revealTargetIdRef.current;
		revealTargetIdRef.current = null;

		dismissFlow();
		if (!wasSuccess) return;

		clearSelectionMode();

		if (!targetId) return;
		const song = displayedSongs.find((s) => s.track.id === targetId);
		if (!song) return;

		openSong(song);
		centerSongInList(targetId);
	}, [
		flowState.step,
		dismissFlow,
		clearSelectionMode,
		displayedSongs,
		openSong,
		centerSongInList,
	]);

	useShortcut({
		key: "enter",
		handler: () => {
			if (selectionMode && showSelectionUI) {
				handleUnlockConfirm();
				return;
			}

			openFocusedSong();
		},
		description: selectionMode ? "Unlock selected songs" : "Open song details",
		scope: "liked-list",
		category: "actions",
		enabled: !isExpanded && focusedIndex >= 0,
	});

	useShortcut({
		key: "escape",
		handler: exitSelectionMode,
		description: "Cancel song selection",
		scope: "liked-list",
		category: "actions",
		enabled: !isExpanded && selectionMode && showSelectionUI,
	});

	return (
		<div
			className="relative min-h-150 transition-[padding-right] duration-300 motion-reduce:transition-none"
			style={{
				paddingRight: isExpanded ? PANEL_WIDTH : "0px",
				transitionTimingFunction: "var(--ease-out-quart)",
			}}
		>
			<div ref={containerRef} className="@container mx-auto max-w-5xl">
				<LikedSongsHeader
					stats={stats}
					lockedSongCount={lockedSongCount}
					showSelectionUI={showSelectionUI}
					selectionMode={selectionMode}
					activeFilter={filter}
					onFilterChange={handleFilterChange}
					onEnterSelectionMode={enterSelectionMode}
					searchQuery={searchQuery}
					onSearchChange={setSearchQuery}
					isWalkthrough={isWalkthrough}
				/>

				{selectionMode && showSelectionUI && billingState && (
					<SongSelectionBar
						containerRef={selectionBarRef}
						selectedCount={selectedSongIds.size}
						remainingBalance={billingState.creditBalance}
						onConfirm={handleUnlockConfirm}
						onCancel={exitSelectionMode}
					/>
				)}

				{showPaywall && billingState && (
					<div className="theme-surface-dim-bg theme-border-color mb-6 rounded-xl border px-6 py-4">
						<PaywallCTA billingState={billingState} />
					</div>
				)}

				<LikedSongsList
					data={{
						isLoading,
						filter,
						displayedSongs,
						visibleSongs,
						hasMore,
						searchQuery: isSearching ? debouncedSearchQuery : null,
					}}
					selection={{
						isActive: selectionMode && showSelectionUI,
						selectedSongIds,
						scrollMarginTop: selectionModeScrollMarginTop,
						onToggleSelect: toggleSongSelection,
					}}
					navigation={{
						selectedSongId,
						closingToSongId,
						isExpanded,
						navIndexBySongId,
						getItemProps,
						onCardClick: handleCardClick,
						sentinelRef,
					}}
					walkthrough={{
						isActive: isWalkthrough,
						songId: walkthroughSong?.id ?? null,
					}}
				/>
			</div>

			{conceptSong && (
				<SongDetailPanel
					song={conceptSong}
					isExpanded={isExpanded}
					hasNext={isWalkthrough ? false : hasNext}
					hasPrevious={isWalkthrough ? false : hasPrevious}
					onClose={handleClose}
					onNext={handleNextSong}
					onPrevious={handlePreviousSong}
					isWalkthrough={isWalkthrough}
					isEnrichmentRunning={isEnrichmentRunning}
					lockedCta={lockedCta}
					playlists={playlists}
				/>
			)}

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
		</div>
	);
}

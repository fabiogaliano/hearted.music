import {
	useCallback,
	useEffect,
	useLayoutEffect,
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
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

import { LikedSongsHeader } from "./components/LikedSongsHeader";
import { LikedSongsList } from "./components/LikedSongsList";
import { SongDetailPanel } from "./components/SongDetailPanel";
import { SongSelectionBar } from "./components/SongSelectionBar";
import { UnlockConfirmDialog } from "./components/UnlockConfirmDialog";
import { useLikedSongsListController } from "./hooks/useLikedSongsListController";
import { useLikedSongsListModel } from "./hooks/useLikedSongsListModel";
import { useLikedSongsPageData } from "./hooks/useLikedSongsPageData";
import { useSongExpansion } from "./hooks/useSongExpansion";
import { useSongUnlock } from "./hooks/useSongUnlock";
import type { FilterOption } from "./queries";

const useIsomorphicLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;
const LIST_TOP_GAP_PX = 24;

interface LikedSongsPageProps {
	initialFilter?: FilterOption;
	selectedSlug?: string | null;
	isDarkMode?: boolean;
	accountId: string;
	billingState?: BillingState;
	onboardingSession?: OnboardingSession;
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
	const selectionBarRef = useRef<HTMLDivElement | null>(null);
	const [selectionBarHeight, setSelectionBarHeight] = useState<number>(0);

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
			clearSelectionMode();
		}
	}, [clearSelectionMode, dismissFlow, flowState.step]);

	useShortcut({
		key: "mod+d",
		handler: () => setIsDarkMode((prev) => !prev),
		description: "Toggle dark mode",
		scope: "liked-list",
		category: "actions",
	});

	const filter = initialFilter;
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
		filter,
		selectedSlug,
		isWalkthrough,
		walkthroughSong,
		isEnrichmentRunning,
	});

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
	});

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
	} = useLikedSongsListController({
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
	});

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
		<div ref={containerRef} className="relative min-h-150 max-w-5xl">
			<LikedSongsHeader
				stats={stats}
				showSelectionUI={showSelectionUI}
				selectionMode={selectionMode}
				onEnterSelectionMode={enterSelectionMode}
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

			<LikedSongsList
				data={{
					isLoading,
					filter,
					displayedSongs,
					visibleSongs,
					hasMore,
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

			{selectedSong && (
				<SongDetailPanel
					song={selectedSong}
					albumArtUrl={selectedSong.track.image_url ?? undefined}
					artistImageUrl={selectedSong.track.artist_image_url ?? undefined}
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

/**
 * Match deck session shell — extracted from match.tsx (Deepening #2). Owns
 * session lifecycle (completion capture, boundary invalidation) and mounts
 * the session-state hook + the per-card content component. See
 * useMatchDeckSession for the state/actions this delegates to.
 */

import type { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { dashboardKeys } from "@/features/dashboard/queries";
import { matchDeckKeys } from "@/features/matching/deck-queries";
import { Matching } from "@/features/matching/Matching";
import { matchReviewSummaryKeys } from "@/features/matching/queries";
import { useMatchDeckSession } from "@/features/matching/useMatchDeckSession";
import { useAnalytics } from "@/lib/observability/useAnalytics";
import type { MatchDeckView } from "@/lib/server/match-deck.functions";
import { QueueCardContent } from "./QueueCardContent";
import type { CompletionStats, MatchViewMode } from "./types";

interface QueueMatchContentProps {
	accountId: string;
	/** URL-backed orientation for this session — drives invalidation key scoping. */
	mode: MatchViewMode;
	/** The active deck view — its itemIds are the navigable timeline. */
	view: MatchDeckView;
	onExit: () => void;
	/** Navigates to the canonical URL for the new mode and persists the preference. */
	onModeChange: (mode: MatchViewMode) => void;
	queryClient: ReturnType<typeof useQueryClient>;
}

export function QueueMatchContent({
	accountId,
	mode,
	view,
	onExit,
	onModeChange,
	queryClient,
}: QueueMatchContentProps) {
	const analytics = useAnalytics();

	// The deck view is the single source of truth for navigation: server-ordered
	// unresolved item ids (append-only total for the progress denominator). No
	// local locallyResolvedIds/effectiveItemIds reconciliation — a whole-card
	// action returns the fresh view (applied to the deck cache) and moves the
	// pointer, so the server is authoritative after every action.
	const itemIds = view.itemIds;
	const total = view.progress.total;

	const { state, actions, resolvedCurrentItemId } = useMatchDeckSession(
		itemIds,
		total,
		view.cards.current?.itemId ?? itemIds[0] ?? null,
	);
	const { addedTo, navigationStatus, sessionStats, pastItems } = state;

	// currentIndex drives the X-of-Y display and prev/next bounds — both in the
	// unresolved domain so numerator and denominator are always consistent.
	const currentIndex =
		resolvedCurrentItemId !== null
			? itemIds.indexOf(resolvedCurrentItemId)
			: -1;

	const isComplete = resolvedCurrentItemId === null;

	// Refresh sidebar badge + deck read on session exit, whether the user
	// completes all cards or navigates away mid-session. Scoped to the current
	// orientation so playlist-mode invalidation doesn't evict song-mode cache.
	const invalidateSessionBoundary = useCallback(() => {
		queryClient.invalidateQueries({
			queryKey: matchDeckKeys.deck(accountId, mode),
		});
		queryClient.invalidateQueries({
			queryKey: matchReviewSummaryKeys.summary(accountId, mode),
		});
		queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
	}, [queryClient, accountId, mode]);

	const completionCapturedRef = useRef(false);
	useEffect(() => {
		if (!isComplete || completionCapturedRef.current) return;
		completionCapturedRef.current = true;
		analytics.capture("matching_session_completed", { total_songs: total });
		invalidateSessionBoundary();
	}, [isComplete, total, analytics, invalidateSessionBoundary]);

	// Cleanup effect: covers departure via sidebar nav or browser back.
	useEffect(
		() => () => {
			invalidateSessionBoundary();
		},
		[invalidateSessionBoundary],
	);

	// skippedCount is tracked explicitly (incremented when a card is finished with
	// no adds, or an unavailable card is skipped) rather than derived from
	// currentIndex. Once resolved cards leave itemIds, the position-based
	// derivation went negative on the first action and undercounted skips.
	const completionStats: CompletionStats = useMemo(
		() => ({
			totalItems: total,
			itemsMatched: sessionStats.songsWithAdditions.size,
			totalAdditions: sessionStats.addedCount,
			dismissedCount: sessionStats.dismissedCount,
			skippedCount: sessionStats.skippedCount,
		}),
		[total, sessionStats],
	);

	if (isComplete || !resolvedCurrentItemId) {
		return (
			<Matching
				currentReviewItem={null}
				currentSuggestions={[]}
				totalSongs={total}
				offset={itemIds.length}
				addedTo={[]}
				isComplete={true}
				completionStats={completionStats}
				recentItems={pastItems}
				onAdd={() => {}}
				onDismiss={() => {}}
				onNext={() => {}}
				onExit={onExit}
			/>
		);
	}

	// Intentionally NOT keyed by item id. Keeping QueueCardContent mounted across
	// cards leaves the header chrome + entrance animation in place and lets the
	// song/matches panels run their AnimatePresence song-to-song slide (a keyed
	// remount would instead replay the whole-page entrance on every advance and
	// leave the panels with no exit). itemId flows in as a prop; the effects below
	// re-run on itemId change.
	return (
		<QueueCardContent
			accountId={accountId}
			itemId={resolvedCurrentItemId}
			currentIndex={currentIndex}
			total={total}
			mode={mode}
			unresolvedIds={itemIds}
			addedTo={addedTo}
			navigationStatus={navigationStatus}
			pastItems={pastItems}
			completionStats={completionStats}
			sessionActions={actions}
			onModeChange={onModeChange}
			onExit={onExit}
			analytics={analytics}
			queryClient={queryClient}
		/>
	);
}

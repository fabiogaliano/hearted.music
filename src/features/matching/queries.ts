import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { dashboardKeys } from "@/features/dashboard/queries";
import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import {
	getMatchReviewSummary,
	getPreferredMatchReviewSummary,
} from "@/lib/server/match-review-queue.functions";
import { matchDeckKeys } from "./deck-queries";

export const matchReviewKeys = {
	all: ["match-review"] as const,
	// Prefix for all review (queue list) keys — useful for broad invalidation
	// when strictness or session state changes affect all orientations.
	reviewsRoot: ["match-review", "review"] as const,
	review: (accountId: string, orientation: MatchOrientation) =>
		["match-review", "review", accountId, orientation] as const,
};

// Queue-aware summary keys. Drive sidebar badge and dashboard CTA.
// Invalidated on matchSnapshotRefresh completion (useActiveJobs) and after
// queue mutations that change the pending count.
export const matchReviewSummaryKeys = {
	// Prefix for all summary keys — use for broad invalidation across orientations.
	summariesRoot: ["match-review", "summary"] as const,
	summary: (accountId: string, orientation: MatchOrientation) =>
		["match-review", "summary", accountId, orientation] as const,
	// Preference-driven summary: resolves orientation from stored user preference.
	preferredSummary: (accountId: string) =>
		["match-review", "summary", accountId, "preferred"] as const,
};

export function matchReviewSummaryQueryOptions(
	accountId: string,
	orientation: MatchOrientation,
) {
	return queryOptions({
		queryKey: matchReviewSummaryKeys.summary(accountId, orientation),
		queryFn: () => getMatchReviewSummary({ data: { orientation } }),
		staleTime: 60_000,
	});
}

/**
 * Query options for the preference-driven summary.
 * The server function reads match_view_mode from user_preferences and delegates
 * to the appropriate orientation summary — no orientation param needed here.
 * Invalidate matchReviewSummaryKeys.preferredSummary(accountId) and
 * dashboardKeys.pageData(accountId) after a successful preference update.
 */
export function preferredMatchReviewSummaryQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: matchReviewSummaryKeys.preferredSummary(accountId),
		queryFn: () => getPreferredMatchReviewSummary({ data: undefined }),
		staleTime: 60_000,
	});
}

// Extracted so the invalidation sequence can be unit-tested without a
// running React tree or real timers. The hook's falling-edge branch delegates
// entirely to this function; runtime behavior is identical to the previous
// inline async IIFE.
export async function runMatchSnapshotRefreshEffects(
	queryClient: QueryClient,
	accountId: string,
): Promise<void> {
	// Deck read model: a mid-session snapshot refresh must re-run the bounded deck
	// read so newly appended subjects surface. Appends are worker-driven now
	// (append_sessions jobs), so there is no request-path sync to await first.
	// deckRoot invalidates every (account, orientation) deck query; per-card
	// read/suggestion keys hang off matchDeckKeys.card and are intentionally left
	// alone — refetching an individual card mid-review would interrupt the user's
	// current card.
	queryClient.invalidateQueries({
		queryKey: matchDeckKeys.deckRoot,
	});

	// Queue-aware summary: drives sidebar badge + dashboard CTA count. Using
	// summariesRoot invalidates all orientation summary queries in one call.
	queryClient.invalidateQueries({
		queryKey: matchReviewSummaryKeys.summariesRoot,
	});

	// Dashboard surfaces updated by the new snapshot. stats backs the CTA's
	// reviewCount — without invalidating it the preview fan refreshes while the
	// count stays stale. pageData keeps the route-loader cache fresh.
	queryClient.invalidateQueries({
		queryKey: dashboardKeys.stats(accountId),
	});
	queryClient.invalidateQueries({
		queryKey: dashboardKeys.pageData(accountId),
	});
	queryClient.invalidateQueries({
		queryKey: dashboardKeys.matchPreviews(accountId),
	});
}

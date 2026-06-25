import { queryOptions } from "@tanstack/react-query";
import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import {
	getMatchReview,
	getMatchReviewItem,
	getMatchReviewSummary,
} from "@/lib/server/match-review-queue.functions";

// matchReviewKeys.item is intentionally NOT in the snapshot-refresh invalidation
// set so per-card data stays stable while the queue list grows.
export const matchReviewKeys = {
	all: ["match-review"] as const,
	// Prefix for all review (queue list) keys — useful for broad invalidation
	// when strictness or session state changes affect all orientations.
	reviewsRoot: ["match-review", "review"] as const,
	review: (accountId: string, orientation: MatchOrientation) =>
		["match-review", "review", accountId, orientation] as const,
	item: (itemId: string) => ["match-review", "item", itemId] as const,
};

export function matchReviewQueryOptions(
	accountId: string,
	orientation: MatchOrientation,
) {
	return queryOptions({
		queryKey: matchReviewKeys.review(accountId, orientation),
		queryFn: () => getMatchReview(),
		// 60 s: short enough that snapshot-refresh invalidation refetches promptly,
		// long enough that rapid card navigation doesn't hammer the server.
		staleTime: 60_000,
	});
}

export function matchReviewItemQueryOptions(itemId: string) {
	return queryOptions({
		queryKey: matchReviewKeys.item(itemId),
		queryFn: () => getMatchReviewItem({ data: { itemId } }),
		// Per-card data is immutable once loaded (song/matches don't change mid-session).
		// High staleTime prevents re-fetches when the queue query refreshes.
		staleTime: 30 * 60_000,
	});
}

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
		queryFn: () => getMatchReviewSummary(),
		staleTime: 60_000,
	});
}

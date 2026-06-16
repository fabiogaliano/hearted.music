import { queryOptions } from "@tanstack/react-query";
import {
	getMatchReview,
	getMatchReviewItem,
	getMatchReviewSummary,
} from "@/lib/server/match-review-queue.functions";

// matchReviewKeys.item is intentionally NOT in the snapshot-refresh invalidation
// set so per-card data stays stable while the queue list grows.
export const matchReviewKeys = {
	all: ["match-review"] as const,
	review: (accountId: string) => ["match-review", "review", accountId] as const,
	item: (itemId: string) => ["match-review", "item", itemId] as const,
};

export function matchReviewQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: matchReviewKeys.review(accountId),
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

// Queue-aware summary key. Drives sidebar badge and dashboard CTA.
// Invalidated on matchSnapshotRefresh completion (useActiveJobs) and after
// queue mutations that change the pending count.
export const matchReviewSummaryKeys = {
	summary: (accountId: string) =>
		["match-review", "summary", accountId] as const,
};

export function matchReviewSummaryQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: matchReviewSummaryKeys.summary(accountId),
		queryFn: () => getMatchReviewSummary(),
		staleTime: 60_000,
	});
}

import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { dashboardKeys } from "@/features/dashboard/queries";
import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import {
	getMatchReview,
	getMatchReviewItem,
	getMatchReviewSummary,
	getPreferredMatchReviewSummary,
	presentMatchReviewItem,
	syncActiveMatchReviewSessions,
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
		queryFn: () => getMatchReview({ data: { orientation } }),
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

/**
 * Authoritative card query: calls presentMatchReviewItem (POST), which captures
 * the visible pair set and returns render-ready data keyed off captured rows.
 *
 * Separate from matchReviewItemQueryOptions so the side-effectful capture path
 * is never confused with the side-effect-free prefetch warming path (D9, D10).
 * First-write-wins capture makes refetches safe — the same rows come back on retry.
 *
 * Do NOT use this key for next-card prefetch — capture should only fire when
 * the user is actually being shown the card, not speculatively.
 */
export function presentMatchReviewItemQueryOptions(itemId: string) {
	return queryOptions({
		queryKey: [...matchReviewKeys.item(itemId), "present"] as const,
		queryFn: () => presentMatchReviewItem({ data: { itemId } }),
		// Capture is first-write-wins idempotent, so refetches always return the
		// same captured rows. High staleTime matches the non-authoritative path.
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
	// Sync must complete before queue queries refetch so new tail items are
	// already in the DB when reviewsRoot invalidation fires. Failure is
	// swallowed: a missed sync just means no new items this round; the user
	// won't lose existing cards.
	try {
		await syncActiveMatchReviewSessions();
	} catch {
		// Best-effort — proceed to invalidations regardless.
	}

	// Invalidate all orientation review queries (reviewsRoot prefix) so every
	// active card stack picks up newly appended items regardless of orientation.
	// Per-card item queries must NOT be invalidated here — refetching an
	// individual card mid-review would interrupt the user's current card.
	// matchReviewKeys.item is intentionally absent from this block.
	queryClient.invalidateQueries({
		queryKey: matchReviewKeys.reviewsRoot,
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

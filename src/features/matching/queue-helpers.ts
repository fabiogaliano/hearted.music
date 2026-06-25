import type { MatchReviewResult } from "@/lib/server/match-review-queue.functions";

/**
 * Derives ordered unresolved item ids from the queue summary.
 *
 * Only pending and active items need a card — resolved items are already
 * decided. Sorting by position preserves the server-assigned enqueue order
 * (new songs first, then score-descending).
 *
 * This pure function is extracted from the route component so it can be unit-
 * tested without a DOM or query client.
 */
export function deriveUnresolvedIds(queue: MatchReviewResult | null): string[] {
	if (!queue) return [];
	return queue.items
		.filter((item) => item.state === "pending" || item.state === "active")
		.sort((a, b) => a.position - b.position)
		.map((item) => item.id);
}

/**
 * Derives whether the queue is caught up from queue state.
 *
 * Caught-up is true when caughtUp is true OR there are no unresolved items.
 * This is always derived from server state — never from null song data.
 */
export function deriveCaughtUp(
	queue: MatchReviewResult | null,
	unresolvedIds: string[],
): boolean {
	if (!queue) return true;
	return queue.caughtUp || unresolvedIds.length === 0;
}

/**
 * Resolves the stable current item id given the id-based pointer and the
 * current unresolved list.
 *
 * Tracking by id rather than by numeric offset means that when a refetch drops
 * resolved items from the head of the list the current card is unaffected —
 * `indexOf(currentItemId)` is stable across head-drops and tail-appends alike.
 *
 * Fallback: if the tracked id is no longer present (resolved externally) we
 * fall back to the first unresolved item rather than crashing or jumping
 * arbitrarily.
 */
export function resolveCurrentItemId(
	unresolvedIds: string[],
	currentItemId: string | null,
): string | null {
	if (unresolvedIds.length === 0) return null;
	if (currentItemId !== null && unresolvedIds.includes(currentItemId)) {
		return currentItemId;
	}
	return unresolvedIds[0] ?? null;
}

/**
 * Counts growth in queue.total since the last known total.
 *
 * Using total (append-only from the server) rather than unresolvedIds.length
 * ensures the passive chip fires correctly even when resolved items drop from
 * the head at the same time new items land at the tail (net-zero on length,
 * but total still grew).
 */
export function countAppendedFromTotal(
	prevTotal: number,
	nextTotal: number,
): number {
	return Math.max(0, nextTotal - prevTotal);
}

/**
 * Picks the next current item after the user resolves `resolvedId`.
 *
 * `effectiveItemIds` is the still-unresolved list at the moment of the action —
 * it still contains `resolvedId` because the resolution hasn't been applied to
 * local state yet. We return the item immediately after it (forward advance),
 * or null when it was the last card (caught-up).
 *
 * Returning null when `resolvedId` is missing is intentional: the caller pairs
 * this with resolveCurrentItemId, whose own fallback re-selects the first
 * unresolved item, so a stale id degrades gracefully rather than crashing.
 */
export function nextItemIdAfterResolved(
	effectiveItemIds: string[],
	resolvedId: string,
): string | null {
	const index = effectiveItemIds.indexOf(resolvedId);
	if (index === -1) return null;
	return effectiveItemIds[index + 1] ?? null;
}

/**
 * Zero-based progress position of the current card within the whole session.
 *
 * The header reads "song X of Y" as progress through the pile, so the numerator
 * must count UP while the denominator holds at the full session size. Deriving
 * it from `total - unresolvedCount` does exactly that: each resolved card leaves
 * the unresolved list, advancing the position by one, while `total` (append-only)
 * keeps the denominator steady.
 *
 * This replaces deriving the position from the unresolved index alone, which was
 * the count-down bug: every forward action resolves the current card and drops it
 * from the unresolved list, so the current card is always that list's head
 * (index 0). The numerator stayed pinned at 1 and the denominator shrank
 * (6 → 5 → 4) instead of the numerator climbing (1 → 2 → 3).
 *
 * Clamped at 0 so a transient snapshot where the unresolved list is briefly
 * longer than `total` (e.g. an append landing a tick before total updates) cannot
 * produce a negative position.
 */
export function deriveProgressIndex(
	total: number,
	unresolvedCount: number,
): number {
	return Math.max(0, total - unresolvedCount);
}

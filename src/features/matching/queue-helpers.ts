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

/**
 * Whether an unavailable card should offer the "loosen strictness" affordance
 * instead of reading as permanently gone.
 *
 * An `unavailable` card can be returned for several distinct reasons; only
 * `no-visible-suggestions` means the review subject DOES have
 * matches that are simply hidden under the current strictness bar. That case
 * gets a link to the strictness setting (recoverable), while entitlement/data
 * reasons (`not-entitled`, `missing-song`, `snapshot-not-owned`,
 * `already-resolved`) only get the skip action. The body copy itself always
 * comes from the server's `message`, never re-derived from the URL mode (A1).
 */
export function shouldOfferLoosenStrictness(reason: string): boolean {
	return reason === "no-visible-suggestions";
}

export type Reason =
	| "building"
	| "building-more"
	| "filtered"
	| "none-yet"
	| "caught-up"
	| "no-context";

/**
 * Single derivation for all empty-state reasons, covering both the no-queue
 * and the caught-up branch from match.tsx.
 *
 * No-queue branch (hasQueue=false):
 *   "no-context" is correct ONLY when no processing is running and no visible
 *   match is ready — i.e., genuinely no setup. Everything else is transient
 *   ("building"), including when a first match IS ready but the recovery effect
 *   is still creating the session.
 *
 * Caught-up branch (hasQueue=true, caughtUp=true):
 *   Active-jobs states take priority; terminal states ("filtered", "none-yet",
 *   "caught-up") are only shown when no job is running.
 */
export function deriveEmptyStateReason(signals: {
	hasQueue: boolean;
	caughtUp: boolean;
	isJobsActive: boolean;
	firstVisibleMatchReady: boolean;
	total: number;
	hiddenReviewItemCount: number;
}): Reason {
	if (!signals.hasQueue) {
		if (signals.isJobsActive || signals.firstVisibleMatchReady)
			return "building";
		return "no-context";
	}
	if (
		signals.isJobsActive &&
		!signals.firstVisibleMatchReady &&
		signals.total === 0
	)
		return "building";
	if (signals.isJobsActive) return "building-more";
	if (signals.hiddenReviewItemCount > 0) return "filtered";
	if (signals.total === 0) return "none-yet";
	return "caught-up";
}

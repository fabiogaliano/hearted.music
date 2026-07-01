import type { LibraryProcessingChange } from "./types";

/**
 * Full queue band vocabulary. "interactive" is reserved for scheduler-level
 * overrides (e.g. first-visible bootstrap); billing can only produce the
 * narrower BillingBand subset.
 */
export type QueueBand = "low" | "standard" | "priority" | "interactive";

/**
 * The subset of QueueBand that billing can resolve to.
 * Encodes "billing can't produce interactive" in the type system — any
 * consumer typed as BillingBand cannot accidentally carry "interactive".
 */
export type BillingBand = Exclude<QueueBand, "interactive">;

/**
 * Change kinds that escalate enrichment priority to "priority" regardless of
 * the caller's billing band. All others defer to the billing band unchanged.
 *
 * A Set (rather than an exhaustive Record) is the right shape here: the
 * debounce table works because every row is a static number constant, but
 * enrichment policy is mixed — one kind maps to a constant ("priority"), the
 * rest map to a runtime value (billingBand). An exhaustive Record would need
 * a different encoding for "pass through", making it more complex to read and
 * extend. A named Set keeps extension to one line with zero ambiguity.
 */
const ENRICHMENT_PRIORITY_OVERRIDE_KINDS = new Set<
	LibraryProcessingChange["kind"]
>(["onboarding_target_selection_confirmed"]);

/**
 * Resolves the queue band for an enrichment job.
 *
 * Onboarding confirmations get "priority" regardless of billing so the user's
 * first enrichment pass is never deprioritized behind paid-tier accounts.
 * Every other change kind defers to the billing band.
 */
export function resolveEnrichmentBand(
	billingBand: BillingBand,
	changeKind: LibraryProcessingChange["kind"],
): QueueBand {
	return ENRICHMENT_PRIORITY_OVERRIDE_KINDS.has(changeKind)
		? "priority"
		: billingBand;
}

/**
 * Resolves the queue band for a match snapshot refresh job.
 *
 * When no first-visible review subject exists yet (bootstrap phase), "interactive"
 * priority is forced so the user gets their first match result without waiting
 * behind the general queue. Once the first subject exists, the billing band applies.
 */
export function resolveRefreshBand(
	billingBand: BillingBand,
	flags: { isFirstVisibleBootstrap: boolean },
): QueueBand {
	return flags.isFirstVisibleBootstrap ? "interactive" : billingBand;
}

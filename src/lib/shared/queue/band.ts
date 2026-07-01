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

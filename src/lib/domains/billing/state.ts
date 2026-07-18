/**
 * Canonical billing domain types.
 *
 * These types overlay the raw `account_billing` DB row with narrowed,
 * product-meaningful values. All downstream consumers (workflows, loaders,
 * routes, UI) import from this file — never from database.types.ts directly.
 */

import type { BillingBand } from "@/lib/shared/queue/band";

/** The account's current subscription plan. */
export type BillingPlan = "free" | "quarterly" | "yearly";

/**
 * How the account has unlimited access, if at all.
 * Discriminated union prevents treating absent access as a boolean.
 */
export type UnlimitedAccess =
	| { kind: "none" }
	| { kind: "subscription" }
	| { kind: "self_hosted" };

/**
 * Normalized subscription status.
 *
 * Raw Stripe statuses from `account_billing.subscription_status` are mapped
 * to this set. Callers should never compare against raw Stripe strings.
 *
 * Mapping:
 *   Stripe 'none'                 → 'none'
 *   Stripe 'active'               → 'active'
 *   Stripe 'canceled'             → 'none'         (terminal, access ended)
 *   Stripe 'unpaid'               → 'past_due'     (delinquent, grouped)
 *   Stripe 'past_due'             → 'past_due'
 *   Stripe 'incomplete'           → 'none'         (setup not completed)
 *   Stripe 'incomplete_expired'   → 'none'         (setup expired)
 *   cancel_at_period_end=true     → 'ending'       (override applied in BillingState construction)
 */
export type NormalizedSubscriptionStatus =
	| "none"
	| "active"
	| "ending"
	| "past_due";

/**
 * Maps raw `account_billing.subscription_status` CHECK-constraint values to
 * the normalized set. `cancelAtPeriodEnd=true` overrides 'active' → 'ending'
 * at the BillingState construction site (not here — the mapping is purely for
 * the Stripe status string).
 */
export const STRIPE_STATUS_TO_NORMALIZED: Record<
	string,
	NormalizedSubscriptionStatus
> = {
	none: "none",
	active: "active",
	canceled: "none",
	unpaid: "past_due",
	past_due: "past_due",
	incomplete: "none",
	incomplete_expired: "none",
} as const;

/**
 * Resolved billing state for an account.
 *
 * Built from `account_billing` + conversion logic; not a direct DB row type.
 * Consumed by UI read models, loaders, and workflow queue-band resolution.
 */
export interface BillingState {
	plan: BillingPlan;
	creditBalance: number;
	/** Normalized subscription lifecycle status (Stripe statuses collapsed). */
	subscriptionStatus: NormalizedSubscriptionStatus;
	cancelAtPeriodEnd: boolean;
	/** ISO timestamp of the current subscription period end, if any. */
	subscriptionPeriodEnd: string | null;
	unlimitedAccess: UnlimitedAccess;
	/** Resolved queue band for this account's pending jobs. Never "interactive" — billing can't produce that level. */
	queueBand: BillingBand;
}

/**
 * Canonical free-tier billing state.
 *
 * Used both as the self-heal default when an `account_billing` row is missing
 * and as the degradation fallback when a billing read fails. Keep this as the
 * single source so the two paths can never drift.
 */
export const FREE_BILLING_STATE: BillingState = Object.freeze<BillingState>({
	plan: "free",
	creditBalance: 0,
	subscriptionStatus: "none",
	cancelAtPeriodEnd: false,
	subscriptionPeriodEnd: null,
	unlimitedAccess: { kind: "none" },
	queueBand: "low",
});

/**
 * Display state for a single song in an account's library.
 *
 * Replaces `UIAnalysisStatus`. `locked` is new — supersedes both analysis
 * and matching status for non-entitled songs.
 */
export type SongDisplayState =
	| "locked"
	| "pending"
	| "analyzing"
	| "analyzed"
	| "failed";

/**
 * Derived helper: returns true when the account has any active unlimited access
 * (subscription or self-hosted). Does not gate on plan — `self_hosted` accounts
 * may have `plan='free'`.
 */
export function hasUnlimitedAccess(state: BillingState): boolean {
	return state.unlimitedAccess.kind !== "none";
}

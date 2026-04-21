/**
 * Pure fulfillment evaluation for a checkout attempt.
 *
 * Pack: fulfilled when the live credit balance has risen above the baseline
 *       captured when the attempt started (so re-purchases are detected even
 *       if the user already had credits).
 * Unlimited: fulfilled when the account has an active subscription.
 *
 * This is the single source of truth — polling hooks and the success page
 * must delegate here; no call site should reinvent the check.
 */

import type { BillingState } from "@/lib/domains/billing/state";
import type { CheckoutIntent } from "@/features/onboarding/checkout-intent";

export function isCheckoutFulfilled(
	intent: CheckoutIntent,
	state: BillingState,
): boolean {
	switch (intent.kind) {
		case "pack":
			return state.creditBalance > intent.baselineCreditBalance;
		case "unlimited":
			return state.unlimitedAccess.kind === "subscription";
	}
}

/**
 * User-facing labels derived from BillingState.
 */

import type { BillingState } from "./state";
import { hasUnlimitedAccess } from "./state";

/**
 * Returns the user-facing plan label for the sidebar.
 *
 * Label priority:
 *   1. Self-hosted unlimited → "Unlimited"
 *   2. Subscription unlimited (quarterly) → "3-Month Unlimited"
 *   3. Subscription unlimited (yearly) → "Backstage Pass"
 *   4. Free with purchased credits → "Song Pack"
 *   5. Free (no credits, no unlimited) → "Free Plan"
 */
export function getPlanLabel(state: BillingState): string {
	if (state.unlimitedAccess.kind === "self_hosted") {
		return "Unlimited";
	}

	if (state.unlimitedAccess.kind === "subscription") {
		return state.plan === "quarterly" ? "3-Month Unlimited" : "Backstage Pass";
	}

	if (state.creditBalance > 0) {
		return "Song Pack";
	}

	return "Free Plan";
}

/**
 * Returns the songs-to-explore balance to display, or null when
 * the balance should be hidden (unlimited or zero credits).
 */
export function getDisplayBalance(state: BillingState): number | null {
	if (hasUnlimitedAccess(state)) {
		return null;
	}

	if (state.creditBalance > 0) {
		return state.creditBalance;
	}

	return null;
}

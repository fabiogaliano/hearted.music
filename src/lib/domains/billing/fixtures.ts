/**
 * Shared billing-state test/story fixture.
 *
 * Base is the free-tier state; callers pass `overrides` for every field they
 * need to diverge on (plan, credits, subscription, unlimited access, queue
 * band). Keeping one builder means the ~dozen free-tier literals scattered
 * across tests and Ladle stories can't drift from `FREE_BILLING_STATE` or
 * from each other.
 */

import type { BillingState } from "@/lib/domains/billing/state";
import { FREE_BILLING_STATE } from "@/lib/domains/billing/state";

export function makeBillingState(
	overrides: Partial<BillingState> = {},
): BillingState {
	return { ...FREE_BILLING_STATE, ...overrides };
}

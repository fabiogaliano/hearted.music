/**
 * Intent-eligibility helpers for the playlist creation preview engine.
 *
 * The natural-language intent field is a premium feature. Eligibility is:
 *   hasUnlimitedAccess(billingState)   (Backstage Pass / self-hosted)
 *
 * The pack-accumulation path is disabled for now: there is no 1,000-song pack
 * tier, so buying a pack can't reach the threshold and framing progress toward
 * it as a running song count would misrepresent the offer. A pass is the only
 * way in until that tier exists.
 *
 * This is always computed server-side and never trusted from the client.
 */

import type { BillingState } from "@/lib/domains/billing/state";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";

/**
 * One any-of path through the intent gate, as data so the UI can explain WHY
 * the field is locked and how close the user is — never just a boolean.
 */
export interface GateCriterionVM {
	id: string;
	/** e.g. "Backstage Pass". */
	label: string;
	met: boolean;
	/** Present for accumulative criteria (unlock counts) — enables "340 / 1,000". */
	progress?: { current: number; target: number };
}

/** Any-of gate: `allowed` is true when at least one criterion is met. */
export interface IntentGateVM {
	allowed: boolean;
	criteria: GateCriterionVM[];
}

/**
 * The intent gate as data: the single source of truth for whether an account
 * may use the natural-language intent field AND why. One any-of path for now —
 * unlimited access (Backstage Pass / self-hosted). The locked treatment reads
 * the criteria; keeping this the sole lever means re-enabling a pack path later
 * is a change here, not in every surface.
 */
export function buildIntentGate(billingState: BillingState): IntentGateVM {
	const hasPass = hasUnlimitedAccess(billingState);

	return {
		allowed: hasPass,
		criteria: [{ id: "backstage-pass", label: "Backstage Pass", met: hasPass }],
	};
}

/**
 * Pure predicate: is this account eligible to use the intent field? Thin
 * wrapper over buildIntentGate so the gate stays the single source of truth.
 */
export function isIntentEligible(billingState: BillingState): boolean {
	return buildIntentGate(billingState).allowed;
}

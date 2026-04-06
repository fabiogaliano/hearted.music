/**
 * Ladle stub for @/lib/server/billing.functions.
 *
 * Re-exports types/interfaces verbatim and replaces server function callables
 * with async rejects so components fall to their error/unavailable states.
 */

import type { BillingState } from "@/lib/domains/billing/state";

// ── Types (re-exported as-is) ──────────────────────────────────────────

export type RequestSongUnlockResponse =
	| {
			success: true;
			newlyUnlockedIds: string[];
			alreadyUnlockedIds: string[];
			remainingBalance: number;
	  }
	| {
			success: false;
			error: "insufficient_balance";
			required: number;
			available: number;
	  }
	| { success: false; error: "billing_service_error"; message: string };

export type CreateCheckoutSessionResponse =
	| { success: true; checkoutUrl: string }
	| { success: false; error: "billing_disabled" }
	| { success: false; error: "invalid_offer" }
	| { success: false; error: "billing_service_error"; message: string };

export type CreatePortalSessionResponse =
	| { success: true; portalUrl: string }
	| { success: false; error: "billing_disabled" }
	| { success: false; error: "billing_service_error"; message: string };

export interface PlanSelectionConfig {
	quarterlyPlanEnabled: boolean;
}

// ── Stub callables ─────────────────────────────────────────────────────

const reject = () =>
	Promise.reject(new Error("[Ladle stub] server function unavailable"));

export const getBillingState = reject as unknown as () => Promise<BillingState>;
export const requestSongUnlock = reject as unknown as (opts: {
	data: { songIds: string[] };
}) => Promise<RequestSongUnlockResponse>;
export const createCheckoutSession = reject as unknown as (opts: {
	data: { offer: string; checkoutAttemptId: string };
}) => Promise<CreateCheckoutSessionResponse>;
export const createPortalSession =
	reject as unknown as () => Promise<CreatePortalSessionResponse>;
export const getPlanSelectionConfig =
	reject as unknown as () => Promise<PlanSelectionConfig>;

/**
 * Ladle stub for @/lib/server/billing.functions.
 *
 * Type-only imports the real module's result types (erased before module
 * resolution, so the real module's server graph never reaches the Ladle
 * bundle) and replaces server function callables with async rejects so
 * components fall to their error/unavailable states.
 */

import type { BillingState } from "@/lib/domains/billing/state";
import type {
	CreateCheckoutSessionResponse,
	CreatePortalSessionResponse,
	PlanSelectionConfig,
	RequestSongUnlockResponse,
	SubscriptionUpgradeQuote,
} from "@/lib/server/billing.functions";

export type {
	CreateCheckoutSessionResponse,
	CreatePortalSessionResponse,
	PlanSelectionConfig,
	RequestSongUnlockResponse,
	SubscriptionUpgradeQuote,
};

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
export function getSubscriptionUpgradeQuote(): Promise<SubscriptionUpgradeQuote> {
	return reject();
}

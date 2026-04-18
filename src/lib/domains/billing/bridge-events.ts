/**
 * Typed payloads for billing-service -> app bridge calls.
 *
 * These shapes are the stable interface between v1_hearted_brand (billing service)
 * and v1_hearted (app). No Stripe-specific types may appear here.
 *
 * Consumed by the bridge ingress handler (Phase 4).
 */

/** Payload for a pack fulfillment bridge call. */
export interface PackFulfilledBridgePayload {
	/** Stripe event ID — used as bridge idempotency key. */
	stripeEventId: string;
	accountId: string;
	/** Song IDs that were unlocked as pack bonus unlocks. */
	bonusUnlockedSongIds: string[];
}

/** Payload for an unlimited access activation bridge call. */
export interface UnlimitedActivatedBridgePayload {
	/** Stripe event ID — used as bridge idempotency key. */
	stripeEventId: string;
	accountId: string;
	stripeSubscriptionId: string;
	subscriptionPeriodEnd: string;
}

/** Payload for a pack reversal bridge call. */
export interface PackReversedBridgePayload {
	stripeEventId: string;
	accountId: string;
	eventKind: "pack_reversed";
	packStripeEventId: string;
	reason: "refund" | "chargeback";
}

/** Payload for an unlimited period reversal bridge call. */
export interface UnlimitedPeriodReversedBridgePayload {
	stripeEventId: string;
	accountId: string;
	eventKind: "unlimited_period_reversed";
	stripeSubscriptionId: string;
	subscriptionPeriodEnd: string;
	reason: "refund" | "chargeback";
}

/** Payload for a subscription deactivation bridge call. */
export interface SubscriptionDeactivatedBridgePayload {
	stripeEventId: string;
	accountId: string;
	eventKind: "subscription_deactivated";
}

/** Union of all revocation-related bridge payloads. */
export type RevocationBridgePayload =
	| PackReversedBridgePayload
	| UnlimitedPeriodReversedBridgePayload
	| SubscriptionDeactivatedBridgePayload;

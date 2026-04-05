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
}

/** Payload for an access revocation outcome bridge call. */
export interface RevocationOutcomeBridgePayload {
	/** Stripe event ID — used as bridge idempotency key. */
	stripeEventId: string;
	accountId: string;
	/**
	 * The event kind that produced this revocation.
	 * Maps to billing_bridge_event.event_kind frozen values.
	 */
	eventKind:
		| "pack_reversed"
		| "unlimited_period_reversed"
		| "subscription_deactivated";
}

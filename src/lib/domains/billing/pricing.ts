/**
 * Display pricing for each billing offer.
 *
 * These amounts are presentation-only — they drive what the UI shows, not what
 * the customer is charged. The authoritative charge comes from the Stripe Price
 * referenced by the matching STRIPE_PRICE_ID_* env var in the v1_hearted_brand
 * billing service, which checkout reads live at session-creation time.
 *
 * Stripe Price amounts are immutable: changing a price means creating a NEW
 * Stripe Price (with a new price_… id), pointing the billing service's
 * STRIPE_PRICE_ID_* env var at it, AND updating `amountCents` here. Keep the
 * two in sync — this file is the single source for every displayed price.
 */

import { SONG_PACK_500, UNLIMITED_QUARTERLY, UNLIMITED_YEARLY } from "./offers";

export type OfferId =
	| typeof SONG_PACK_500
	| typeof UNLIMITED_QUARTERLY
	| typeof UNLIMITED_YEARLY;

interface OfferPricing {
	amountCents: number;
	/** Billing-period suffix shown after the amount, e.g. "/yr". Empty for one-time. */
	suffix: string;
}

export const OFFER_PRICING: Record<OfferId, OfferPricing> = {
	[SONG_PACK_500]: { amountCents: 599, suffix: "" },
	[UNLIMITED_YEARLY]: { amountCents: 3999, suffix: "/yr" },
	[UNLIMITED_QUARTERLY]: { amountCents: 1499, suffix: "/quarter" },
};

export function formatPrice(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

/** Formatted base price with its period suffix, e.g. "$39.99/yr". */
export function formatOfferPrice(offer: OfferId): string {
	const { amountCents, suffix } = OFFER_PRICING[offer];
	return `${formatPrice(amountCents)}${suffix}`;
}

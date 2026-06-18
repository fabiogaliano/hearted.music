/**
 * Internal offer ID constants.
 *
 * These are the stable offer identifiers passed between the public app and the
 * billing service. Only v1_hearted_brand resolves these to Stripe price IDs.
 * Never add Stripe price IDs to this file.
 */

export const SONG_PACK_250 = "song_pack_250" as const;
export const SONG_PACK_500 = "song_pack_500" as const;
export const UNLIMITED_QUARTERLY = "unlimited_quarterly" as const;
export const UNLIMITED_YEARLY = "unlimited_yearly" as const;

export const PACK_OFFER_IDS = [SONG_PACK_250, SONG_PACK_500] as const;
export type PackOfferId = (typeof PACK_OFFER_IDS)[number];

export function isPackOffer(offer: string): offer is PackOfferId {
	return (PACK_OFFER_IDS as readonly string[]).includes(offer);
}

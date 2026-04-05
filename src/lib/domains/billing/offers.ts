/**
 * Internal offer ID constants.
 *
 * These are the stable offer identifiers passed between the public app and the
 * billing service. Only v1_hearted_brand resolves these to Stripe price IDs.
 * Never add Stripe price IDs to this file.
 */

export const SONG_PACK_500 = "song_pack_500" as const;
export const UNLIMITED_QUARTERLY = "unlimited_quarterly" as const;
export const UNLIMITED_YEARLY = "unlimited_yearly" as const;

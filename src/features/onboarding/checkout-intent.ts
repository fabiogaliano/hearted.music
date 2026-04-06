/**
 * Persists checkout intent across Stripe redirect via sessionStorage.
 *
 * Before redirecting to Stripe, we save which offer and checkoutAttemptId
 * the user chose. On return, the component reads this to enter polling mode
 * and reuse the same checkoutAttemptId on retry.
 */

import {
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
} from "@/lib/domains/billing/offers";

const STORAGE_KEY = "hearted:checkout-intent";

const VALID_OFFERS = new Set<string>([
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
]);

type OfferType =
	| typeof SONG_PACK_500
	| typeof UNLIMITED_QUARTERLY
	| typeof UNLIMITED_YEARLY;

export interface CheckoutIntent {
	offer: OfferType;
	checkoutAttemptId: string;
}

export function saveCheckoutIntent(intent: CheckoutIntent): void {
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
	} catch {
		// sessionStorage may be unavailable; checkout still works, just no retry reuse
	}
}

export function loadCheckoutIntent(): CheckoutIntent | null {
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return null;

		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			!("offer" in parsed) ||
			!("checkoutAttemptId" in parsed)
		) {
			return null;
		}

		const { offer, checkoutAttemptId } = parsed as Record<string, unknown>;
		if (typeof offer !== "string" || !VALID_OFFERS.has(offer)) return null;
		if (typeof checkoutAttemptId !== "string") return null;

		return { offer: offer as OfferType, checkoutAttemptId };
	} catch {
		return null;
	}
}

export function clearCheckoutIntent(): void {
	try {
		sessionStorage.removeItem(STORAGE_KEY);
	} catch {
		// Ignore
	}
}

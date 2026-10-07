/**
 * Persists checkout intent across the Stripe redirect via sessionStorage.
 *
 * Intent is a discriminated union: pack intents capture the credit-balance
 * baseline at checkout start so fulfillment can detect any increase (even
 * if the user already had credits); unlimited intents only need the offer.
 * Preprod-only schema (v2) — no backward compatibility with older payloads.
 */

import {
	isPackOffer,
	type PackOfferId,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
} from "@/lib/domains/billing/offers";

const STORAGE_KEY = "hearted:checkout-intent:v2";

type PackOffer = PackOfferId;
type UnlimitedOffer = typeof UNLIMITED_QUARTERLY | typeof UNLIMITED_YEARLY;
export type CheckoutOffer = PackOffer | UnlimitedOffer;

interface PackCheckoutIntent {
	kind: "pack";
	offer: PackOffer;
	checkoutAttemptId: string;
	baselineCreditBalance: number;
}

interface UnlimitedCheckoutIntent {
	kind: "unlimited";
	offer: UnlimitedOffer;
	checkoutAttemptId: string;
}

export type CheckoutIntent = PackCheckoutIntent | UnlimitedCheckoutIntent;

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
		return parseIntent(parsed);
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

function parseIntent(value: unknown): CheckoutIntent | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;

	const { kind, offer, checkoutAttemptId } = record;
	if (typeof checkoutAttemptId !== "string" || checkoutAttemptId.length === 0) {
		return null;
	}

	if (kind === "pack") {
		if (typeof offer !== "string" || !isPackOffer(offer)) return null;
		const baseline = record.baselineCreditBalance;
		if (
			typeof baseline !== "number" ||
			!Number.isFinite(baseline) ||
			baseline < 0
		) {
			return null;
		}
		return {
			kind: "pack",
			offer,
			checkoutAttemptId,
			baselineCreditBalance: baseline,
		};
	}

	if (kind === "unlimited") {
		if (offer !== UNLIMITED_QUARTERLY && offer !== UNLIMITED_YEARLY) {
			return null;
		}
		return { kind: "unlimited", offer, checkoutAttemptId };
	}

	return null;
}

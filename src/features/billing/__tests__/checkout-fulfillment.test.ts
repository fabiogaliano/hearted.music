import { describe, expect, it } from "vitest";
import type { CheckoutIntent } from "@/features/onboarding/checkout-intent";
import { SONG_PACK_500, UNLIMITED_YEARLY } from "@/lib/domains/billing/offers";
import type { BillingState } from "@/lib/domains/billing/state";
import { isCheckoutFulfilled } from "../checkout-fulfillment";

function billing(overrides: Partial<BillingState> = {}): BillingState {
	return {
		plan: "free",
		creditBalance: 0,
		subscriptionStatus: "none",
		cancelAtPeriodEnd: false,
		unlimitedAccess: { kind: "none" },
		queueBand: "low",
		...overrides,
	};
}

describe("isCheckoutFulfilled", () => {
	const packIntent: CheckoutIntent = {
		kind: "pack",
		offer: SONG_PACK_500,
		checkoutAttemptId: "attempt-1",
		baselineCreditBalance: 30,
	};

	const unlimitedIntent: CheckoutIntent = {
		kind: "unlimited",
		offer: UNLIMITED_YEARLY,
		checkoutAttemptId: "attempt-2",
	};

	it("returns false for pack when credit balance equals baseline", () => {
		expect(
			isCheckoutFulfilled(packIntent, billing({ creditBalance: 30 })),
		).toBe(false);
	});

	it("returns false for pack when credit balance is below baseline", () => {
		expect(
			isCheckoutFulfilled(packIntent, billing({ creditBalance: 10 })),
		).toBe(false);
	});

	it("returns true for pack when credit balance rose above baseline", () => {
		expect(
			isCheckoutFulfilled(packIntent, billing({ creditBalance: 530 })),
		).toBe(true);
	});

	it("returns true for unlimited when subscription is active", () => {
		const state = billing({
			plan: "yearly",
			subscriptionStatus: "active",
			unlimitedAccess: { kind: "subscription" },
		});
		expect(isCheckoutFulfilled(unlimitedIntent, state)).toBe(true);
	});

	it("returns false for unlimited when access is self-hosted (not subscription)", () => {
		const state = billing({ unlimitedAccess: { kind: "self_hosted" } });
		expect(isCheckoutFulfilled(unlimitedIntent, state)).toBe(false);
	});

	it("returns false for unlimited when no unlimited access", () => {
		expect(isCheckoutFulfilled(unlimitedIntent, billing())).toBe(false);
	});
});

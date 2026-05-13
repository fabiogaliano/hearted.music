import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCheckoutIntent } from "@/features/onboarding/checkout-intent";
import { SONG_PACK_500 } from "@/lib/domains/billing/offers";
import type { BillingState } from "@/lib/domains/billing/state";

const mockCreateCheckoutSession = vi.fn();

vi.mock("@/lib/server/billing.functions", () => ({
	createCheckoutSession: (args: unknown) => mockCreateCheckoutSession(args),
}));

import { useCheckoutFlow } from "../hooks/useCheckoutFlow";

const billingState: BillingState = {
	plan: "free",
	creditBalance: 30,
	subscriptionStatus: "none",
	cancelAtPeriodEnd: false,
	subscriptionPeriodEnd: null,
	unlimitedAccess: { kind: "none" },
	queueBand: "low",
};

const originalLocation = window.location;

beforeEach(() => {
	sessionStorage.clear();
	mockCreateCheckoutSession.mockReset();
	// Replace window.location so href assignment doesn't trigger jsdom navigation.
	Object.defineProperty(window, "location", {
		configurable: true,
		writable: true,
		value: { href: "" } as Location,
	});
});

afterEach(() => {
	Object.defineProperty(window, "location", {
		configurable: true,
		writable: true,
		value: originalLocation,
	});
});

describe("useCheckoutFlow", () => {
	it("does not persist checkout intent when session creation fails", async () => {
		mockCreateCheckoutSession.mockResolvedValue({
			success: false,
			error: "billing_service_error",
			message: "boom",
		});

		const { result } = renderHook(() => useCheckoutFlow(billingState));

		await act(async () => {
			await result.current.startCheckout(SONG_PACK_500);
		});

		expect(loadCheckoutIntent()).toBeNull();
		expect(window.location.href).toBe("");
		expect(result.current.state.status).toBe("idle");
	});

	it("does not persist checkout intent when session creation throws", async () => {
		mockCreateCheckoutSession.mockRejectedValue(new Error("network down"));

		const { result } = renderHook(() => useCheckoutFlow(billingState));

		await act(async () => {
			await result.current.startCheckout(SONG_PACK_500);
		});

		expect(loadCheckoutIntent()).toBeNull();
		expect(window.location.href).toBe("");
		expect(result.current.state.status).toBe("idle");
	});

	it("persists checkout intent and redirects on success", async () => {
		mockCreateCheckoutSession.mockResolvedValue({
			success: true,
			checkoutUrl: "https://stripe.example/session_123",
		});

		const { result } = renderHook(() => useCheckoutFlow(billingState));

		await act(async () => {
			await result.current.startCheckout(SONG_PACK_500);
		});

		const persisted = loadCheckoutIntent();
		expect(persisted).not.toBeNull();
		expect(persisted?.kind).toBe("pack");
		expect(persisted?.offer).toBe(SONG_PACK_500);
		expect(window.location.href).toBe("https://stripe.example/session_123");
	});
});

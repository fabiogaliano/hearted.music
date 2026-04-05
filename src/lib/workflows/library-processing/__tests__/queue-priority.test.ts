import { describe, expect, it } from "vitest";
import type { BillingState } from "@/lib/domains/billing/state";
import { bandToNumeric, resolveQueuePriority } from "../queue-priority";

function makeBillingState(overrides: Partial<BillingState> = {}): BillingState {
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

describe("resolveQueuePriority", () => {
	it("returns 'low' for free account with no balance", () => {
		const state = makeBillingState({ queueBand: "low" });
		expect(resolveQueuePriority(state)).toBe("low");
	});

	it("returns 'standard' for non-unlimited account with positive credit balance", () => {
		const state = makeBillingState({
			creditBalance: 10,
			queueBand: "standard",
		});
		expect(resolveQueuePriority(state)).toBe("standard");
	});

	it("returns 'standard' for quarterly unlimited active subscription", () => {
		const state = makeBillingState({
			plan: "quarterly",
			subscriptionStatus: "active",
			unlimitedAccess: { kind: "subscription" },
			queueBand: "standard",
		});
		expect(resolveQueuePriority(state)).toBe("standard");
	});

	it("returns 'priority' for yearly unlimited active subscription", () => {
		const state = makeBillingState({
			plan: "yearly",
			subscriptionStatus: "active",
			unlimitedAccess: { kind: "subscription" },
			queueBand: "priority",
		});
		expect(resolveQueuePriority(state)).toBe("priority");
	});

	it("returns 'priority' for self_hosted unlimited access", () => {
		const state = makeBillingState({
			unlimitedAccess: { kind: "self_hosted" },
			queueBand: "priority",
		});
		expect(resolveQueuePriority(state)).toBe("priority");
	});
});

describe("bandToNumeric", () => {
	it("maps low to 0", () => {
		expect(bandToNumeric("low")).toBe(0);
	});

	it("maps standard to 50", () => {
		expect(bandToNumeric("standard")).toBe(50);
	});

	it("maps priority to 100", () => {
		expect(bandToNumeric("priority")).toBe(100);
	});
});

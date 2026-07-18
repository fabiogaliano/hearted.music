import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeBillingState } from "@/lib/domains/billing/fixtures";
import type { BillingState } from "@/lib/domains/billing/state";

const mockAuthContext = {
	session: { accountId: "acct-1" },
	account: null,
};

const mockReadBillingStateOrFreeTier = vi.fn();

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		handler:
			(fn: (args: { context: typeof mockAuthContext }) => unknown) => () =>
				fn({ context: mockAuthContext }),
	});
	return {
		createServerFn: builder,
		createMiddleware: () => ({
			server: () => ({}),
			type: () => ({ server: () => ({}) }),
		}),
	};
});

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/domains/billing/queries", () => ({
	readBillingStateOrFreeTier: (...args: unknown[]) =>
		mockReadBillingStateOrFreeTier(...args),
}));

import { getIntentEligibility } from "../intentEligibility";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("getIntentEligibility", () => {
	it("returns the locked gate when billing degrades to free tier", async () => {
		// readBillingStateOrFreeTier already folded any read failure into
		// FREE_BILLING_STATE — this pins buildIntentGate's output for that input,
		// which is the same VM the deleted LOCKED_GATE_FALLBACK hand-authored.
		mockReadBillingStateOrFreeTier.mockResolvedValue(makeBillingState());

		const gate = await getIntentEligibility();

		expect(gate).toEqual({
			allowed: false,
			criteria: [{ id: "backstage-pass", label: "Backstage Pass", met: false }],
		});
	});

	it("returns the allowed gate when the account has unlimited access", async () => {
		const unlimitedState: BillingState = makeBillingState({
			unlimitedAccess: { kind: "subscription" },
		});
		mockReadBillingStateOrFreeTier.mockResolvedValue(unlimitedState);

		const gate = await getIntentEligibility();

		expect(gate).toEqual({
			allowed: true,
			criteria: [{ id: "backstage-pass", label: "Backstage Pass", met: true }],
		});
	});

	it("threads accountId and a stable operation name to the reader", async () => {
		mockReadBillingStateOrFreeTier.mockResolvedValue(makeBillingState());

		await getIntentEligibility();

		expect(mockReadBillingStateOrFreeTier).toHaveBeenCalledWith(
			expect.anything(),
			"acct-1",
			"get_intent_eligibility",
		);
	});
});

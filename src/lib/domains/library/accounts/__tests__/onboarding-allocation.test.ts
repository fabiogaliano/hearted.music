import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/domains/billing/queries", () => ({
	readBillingState: vi.fn(),
}));

vi.mock("@/lib/domains/billing/unlocks", () => ({
	grantFreeAllocation: vi.fn(),
}));

vi.mock("../preferences-queries", () => ({
	completeOnboarding: vi.fn(),
}));

import type { AdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import type { BillingState } from "@/lib/domains/billing/state";
import { grantFreeAllocation } from "@/lib/domains/billing/unlocks";
import { completeOnboardingWithAllocations } from "../onboarding-allocation";
import { completeOnboarding } from "../preferences-queries";

const mockedReadBilling = vi.mocked(readBillingState);
const mockedGrantFree = vi.mocked(grantFreeAllocation);
const mockedCompleteOnboarding = vi.mocked(completeOnboarding);

function freeBillingState(overrides: Partial<BillingState> = {}): BillingState {
	return {
		plan: "free",
		creditBalance: 0,
		subscriptionStatus: "none",
		cancelAtPeriodEnd: false,
		subscriptionPeriodEnd: null,
		unlimitedAccess: { kind: "none" },
		queueBand: "low",
		...overrides,
	};
}

function makeSupabase(grantRow: unknown, error: unknown = null) {
	const maybeSingle = vi.fn().mockResolvedValue({ data: grantRow, error });
	const eq = vi.fn().mockReturnValue({ maybeSingle });
	const select = vi.fn().mockReturnValue({ eq });
	const from = vi.fn().mockReturnValue({ select });
	return { client: { from } as unknown as AdminSupabaseClient, from };
}

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	mockedCompleteOnboarding.mockResolvedValue(
		Result.ok({ account_id: "a1" } as never),
	);
	mockedReadBilling.mockResolvedValue(Result.ok(freeBillingState()));
	mockedGrantFree.mockResolvedValue(Result.ok({ unlockedIds: ["s1"] }));
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("completeOnboardingWithAllocations", () => {
	it("skips the free allocation when a grant row exists", async () => {
		const { client } = makeSupabase({ account_id: "a1" });

		await completeOnboardingWithAllocations(client, "a1");

		expect(mockedGrantFree).not.toHaveBeenCalled();
	});

	it("grants the free allocation when no grant row exists", async () => {
		const { client } = makeSupabase(null);

		await completeOnboardingWithAllocations(client, "a1");

		expect(mockedGrantFree).toHaveBeenCalledOnce();
	});

	it("does not check the grant or allocate for a non-free account", async () => {
		mockedReadBilling.mockResolvedValue(
			Result.ok(freeBillingState({ creditBalance: 50, queueBand: "standard" })),
		);
		const { client, from } = makeSupabase(null);

		await completeOnboardingWithAllocations(client, "a1");

		expect(from).not.toHaveBeenCalled();
		expect(mockedGrantFree).not.toHaveBeenCalled();
	});

	it("skips the free allocation when the grant-existence check errors", async () => {
		const { client } = makeSupabase(null, { message: "read fail" });

		await completeOnboardingWithAllocations(client, "a1");

		expect(mockedGrantFree).not.toHaveBeenCalled();
	});

	it("returns the completeOnboarding error without allocating", async () => {
		mockedCompleteOnboarding.mockResolvedValue(
			Result.err({ code: "X", message: "onboarding boom" } as never),
		);
		const { client } = makeSupabase(null);

		const result = await completeOnboardingWithAllocations(client, "a1");

		expect(Result.isError(result)).toBe(true);
		expect(mockedGrantFree).not.toHaveBeenCalled();
	});
});

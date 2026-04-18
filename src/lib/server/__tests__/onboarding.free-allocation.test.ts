import { beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

const mockAuthContext = {
	session: { accountId: "acct-free-1" },
	account: null,
};

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler: (fn: Function) => (input?: { data?: unknown }) =>
			fn({ context: mockAuthContext, data: input?.data }),
	});
	return {
		createServerFn: builder,
		createMiddleware: () => ({
			server: () => ({}),
			type: () => ({ server: () => ({}) }),
		}),
	};
});

vi.mock("@/lib/platform/auth/auth.middleware", () => ({
	authMiddleware: {},
}));

const mockCompleteOnboarding = vi.fn();
vi.mock("@/lib/domains/library/accounts/preferences-queries", () => ({
	completeOnboarding: (...args: unknown[]) => mockCompleteOnboarding(...args),
	getOrCreatePreferences: vi.fn(),
	isOnboardingComplete: vi.fn(),
	ONBOARDING_STEPS: { safeParse: vi.fn() },
	updateOnboardingStep: vi.fn(),
	updateTheme: vi.fn(),
	clearPhaseJobIds: vi.fn(),
}));

const mockReadBillingState = vi.fn();
vi.mock("@/lib/domains/billing/queries", () => ({
	readBillingState: (...args: unknown[]) => mockReadBillingState(...args),
}));

const mockGrantFreeAllocation = vi.fn();
vi.mock("@/lib/domains/billing/unlocks", () => ({
	grantFreeAllocation: (...args: unknown[]) => mockGrantFreeAllocation(...args),
}));

const mockCreateAdminSupabaseClient = vi.fn();
vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => mockCreateAdminSupabaseClient(),
}));

vi.mock("@/lib/domains/library/liked-songs/queries", () => ({
	getCount: vi.fn(),
}));

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getPlaylistCount: vi.fn(),
	getPlaylists: vi.fn(),
	setPlaylistTarget: vi.fn(),
}));

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: vi.fn(),
	getMatchResultsForSong: vi.fn(),
}));

vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	get: vi.fn(),
}));

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: vi.fn(),
}));

vi.mock("@/lib/data/demo-matches", () => ({
	getDemoMatchesForSong: vi.fn(() => []),
}));

import type { BillingState } from "@/lib/domains/billing/state";
import { markOnboardingComplete } from "../onboarding.functions";

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

describe("markOnboardingComplete — free allocation", () => {
	const fakeClient = { id: "admin-client" };

	beforeEach(() => {
		vi.clearAllMocks();
		mockCompleteOnboarding.mockResolvedValue(Result.ok(undefined));
		mockCreateAdminSupabaseClient.mockReturnValue(fakeClient);
	});

	it("grants free allocation for free-plan users", async () => {
		mockReadBillingState.mockResolvedValue(Result.ok(makeBillingState()));
		mockGrantFreeAllocation.mockResolvedValue(
			Result.ok({ unlockedIds: ["s1", "s2", "s3"] }),
		);

		const result = await (markOnboardingComplete as Function)();

		expect(result).toEqual({ success: true });
		expect(mockGrantFreeAllocation).toHaveBeenCalledWith(
			fakeClient,
			"acct-free-1",
		);
	});

	it("does not grant free allocation for users with credit balance", async () => {
		mockReadBillingState.mockResolvedValue(
			Result.ok(makeBillingState({ creditBalance: 500 })),
		);

		const result = await (markOnboardingComplete as Function)();

		expect(result).toEqual({ success: true });
		expect(mockGrantFreeAllocation).not.toHaveBeenCalled();
	});

	it("does not grant free allocation for users with unlimited access", async () => {
		mockReadBillingState.mockResolvedValue(
			Result.ok(
				makeBillingState({ unlimitedAccess: { kind: "subscription" } }),
			),
		);

		const result = await (markOnboardingComplete as Function)();

		expect(result).toEqual({ success: true });
		expect(mockGrantFreeAllocation).not.toHaveBeenCalled();
	});

	it("does not grant free allocation for paid plan users", async () => {
		mockReadBillingState.mockResolvedValue(
			Result.ok(
				makeBillingState({
					plan: "yearly",
					unlimitedAccess: { kind: "subscription" },
					subscriptionStatus: "active",
				}),
			),
		);

		const result = await (markOnboardingComplete as Function)();

		expect(result).toEqual({ success: true });
		expect(mockGrantFreeAllocation).not.toHaveBeenCalled();
	});

	it("succeeds even when free allocation fails", async () => {
		mockReadBillingState.mockResolvedValue(Result.ok(makeBillingState()));
		mockGrantFreeAllocation.mockResolvedValue(
			Result.err({
				kind: "db_error",
				cause: { code: "FAIL", message: "boom" },
			}),
		);

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await (markOnboardingComplete as Function)();

		expect(result).toEqual({ success: true });
		expect(consoleSpy).toHaveBeenCalledWith(
			"[onboarding] Free allocation failed:",
			expect.objectContaining({ kind: "db_error" }),
		);

		consoleSpy.mockRestore();
	});

	it("succeeds even when billing state read fails", async () => {
		const { DatabaseError } = await import("@/lib/shared/errors/database");
		mockReadBillingState.mockResolvedValue(
			Result.err(new DatabaseError({ code: "FAIL", message: "db down" })),
		);

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await (markOnboardingComplete as Function)();

		expect(result).toEqual({ success: true });
		expect(mockGrantFreeAllocation).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(
			"[onboarding] Failed to read billing state for free allocation:",
			expect.anything(),
		);

		consoleSpy.mockRestore();
	});
});

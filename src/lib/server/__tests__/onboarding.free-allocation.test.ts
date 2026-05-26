import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthContext = {
	session: { accountId: "acct-free-1" },
	account: null,
};

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler:
			(fn: (...args: unknown[]) => unknown) => (input?: { data?: unknown }) =>
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
	setPlaylistTargets: vi.fn(),
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

vi.mock("@/lib/content/landing/demo-matches", () => ({
	getDemoMatchesForSong: vi.fn(() => []),
}));

import type { BillingState } from "@/lib/domains/billing/state";
import {
	markOnboardingComplete,
	saveDemoSongSelection,
} from "../onboarding.functions";

function makeBillingState(overrides: Partial<BillingState> = {}): BillingState {
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

describe("saveDemoSongSelection ownership", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects demo songs that are not liked by the authenticated account", async () => {
		const single = vi.fn().mockResolvedValue({
			data: { id: "song-1" },
			error: null,
		});
		const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
		const updateEq = vi.fn().mockResolvedValue({ error: null });

		mockCreateAdminSupabaseClient.mockReturnValue({
			from: (table: string) => {
				if (table === "song") {
					return {
						select: () => ({
							eq: () => ({ single }),
						}),
					};
				}
				if (table === "liked_song") {
					return {
						select: () => ({
							eq: () => ({
								eq: () => ({
									is: () => ({ maybeSingle }),
								}),
							}),
						}),
					};
				}
				if (table === "user_preferences") {
					return {
						update: () => ({ eq: updateEq }),
					};
				}
				throw new Error(`Unexpected table: ${table}`);
			},
		});

		await expect(
			saveDemoSongSelection({ data: { spotifyTrackId: "spotify:track:abc" } }),
		).rejects.toThrow(/lookup_demo_song/);
		expect(updateEq).not.toHaveBeenCalled();
	});
});

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

		const result = await (markOnboardingComplete as () => Promise<unknown>)();

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

		const result = await (markOnboardingComplete as () => Promise<unknown>)();

		expect(result).toEqual({ success: true });
		expect(mockGrantFreeAllocation).not.toHaveBeenCalled();
	});

	it("does not grant free allocation for users with unlimited access", async () => {
		mockReadBillingState.mockResolvedValue(
			Result.ok(
				makeBillingState({ unlimitedAccess: { kind: "subscription" } }),
			),
		);

		const result = await (markOnboardingComplete as () => Promise<unknown>)();

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

		const result = await (markOnboardingComplete as () => Promise<unknown>)();

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

		const result = await (markOnboardingComplete as () => Promise<unknown>)();

		expect(result).toEqual({ success: true });
		expect(consoleSpy).toHaveBeenCalled();

		consoleSpy.mockRestore();
	});

	it("succeeds even when billing state read fails", async () => {
		const { DatabaseError } = await import("@/lib/shared/errors/database");
		mockReadBillingState.mockResolvedValue(
			Result.err(new DatabaseError({ code: "FAIL", message: "db down" })),
		);

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await (markOnboardingComplete as () => Promise<unknown>)();

		expect(result).toEqual({ success: true });
		expect(mockGrantFreeAllocation).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalled();

		consoleSpy.mockRestore();
	});
});

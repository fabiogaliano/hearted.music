import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthContext = {
	session: { accountId: "acct-free-1" },
	// account.handle is required by the new markOnboardingComplete structured gate
	account: { handle: "test-handle" },
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

// Mock loadOnboardingSession to return plan-selection so the completion gate passes.
// markOnboardingComplete's new contract checks session.status before calling
// completeOnboardingWithAllocations — the gate must be at "plan-selection".
const mockLoadOnboardingSession = vi.fn();
vi.mock("@/lib/server/onboarding-session", () => ({
	loadOnboardingSession: (...args: unknown[]) =>
		mockLoadOnboardingSession(...args),
	deriveAuthPayloadFromPrefs: vi.fn(),
}));

const mockCompleteOnboarding = vi.fn();
vi.mock("@/lib/domains/library/accounts/preferences-queries", () => ({
	completeOnboarding: (...args: unknown[]) => mockCompleteOnboarding(...args),
	getOrCreatePreferences: vi.fn(),
	isOnboardingComplete: vi.fn(),
	ONBOARDING_STEPS: { safeParse: vi.fn() },
	// SAVEABLE_ONBOARDING_STEPS must be a valid z.enum so the schema construction
	// in saveOnboardingStep doesn't throw during module evaluation.
	SAVEABLE_ONBOARDING_STEPS: { parse: vi.fn(), safeParse: vi.fn() },
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

vi.mock(
	"@/lib/domains/library/liked-songs/queries",
	async (importOriginal: <T>() => Promise<T>) => ({
		...(await importOriginal<
			typeof import("@/lib/domains/library/liked-songs/queries")
		>()),
		getCount: vi.fn(),
	}),
);

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getPlaylistCount: vi.fn(),
	getPlaylists: vi.fn(),
	setPlaylistTargets: vi.fn(),
}));

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: vi.fn(),
	getMatchResultsForSong: vi.fn(),
	getServedRanksForSong: vi.fn(),
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

describe("saveDemoSongSelection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// Demo songs come from the curated landing manifest, not the user's library,
	// so a valid pick is frequently a song the account does not like. Ownership
	// is enforced post-onboarding (addSongToPlaylist/dismissSong), never here.
	it("saves a demo song the account does not own", async () => {
		const single = vi.fn().mockResolvedValue({
			data: { id: "song-1" },
			error: null,
		});
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
		).resolves.toEqual({ success: true });
		expect(updateEq).toHaveBeenCalled();
	});

	it("rejects a spotify id that has no matching song row", async () => {
		const single = vi.fn().mockResolvedValue({
			data: null,
			error: { message: "not found" },
		});

		mockCreateAdminSupabaseClient.mockReturnValue({
			from: (table: string) => {
				if (table === "song") {
					return {
						select: () => ({
							eq: () => ({ single }),
						}),
					};
				}
				throw new Error(`Unexpected table: ${table}`);
			},
		});

		await expect(
			saveDemoSongSelection({
				data: { spotifyTrackId: "spotify:track:missing" },
			}),
		).rejects.toThrow(/lookup_demo_song/);
	});
});

describe("markOnboardingComplete — free allocation", () => {
	// Onboarding now reads account_liked_song_access_grant to skip the free
	// allocation when the larger benefit owns the account; default to no grant
	// row so these free-plan cases still allocate.
	const fakeClient = {
		id: "admin-client",
		from: () => ({
			select: () => ({
				eq: () => ({
					maybeSingle: () => Promise.resolve({ data: null, error: null }),
				}),
			}),
		}),
	};

	// plan-selection payload returned as the gate check — allows completion.
	const planSelectionPayload = {
		session: { status: "plan-selection" as const },
		theme: null,
	};
	// complete payload returned after the write.
	const completePayload = {
		session: { status: "complete" as const },
		theme: null,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		// ok(prefs row) = this call won the compare-and-set completion write.
		mockCompleteOnboarding.mockResolvedValue(
			Result.ok({ account_id: "acct-free-1" }),
		);
		mockCreateAdminSupabaseClient.mockReturnValue(fakeClient);
		// First call: gate check (plan-selection). Second call: post-write verify (complete).
		mockLoadOnboardingSession
			.mockResolvedValueOnce(planSelectionPayload)
			.mockResolvedValueOnce(completePayload);
	});

	it("grants free allocation for free-plan users", async () => {
		mockReadBillingState.mockResolvedValue(Result.ok(makeBillingState()));
		mockGrantFreeAllocation.mockResolvedValue(
			Result.ok({ unlockedIds: ["s1", "s2", "s3"] }),
		);

		const result = await (markOnboardingComplete as () => Promise<unknown>)();

		expect(result).toEqual({
			status: "completed_now",
			onboarding: completePayload,
		});
		expect(mockGrantFreeAllocation).toHaveBeenCalledWith(
			fakeClient,
			"acct-free-1",
		);
	});

	it("grants free allocation for free-plan users even when they already have pack credits", async () => {
		mockReadBillingState.mockResolvedValue(
			Result.ok(makeBillingState({ creditBalance: 500 })),
		);
		mockGrantFreeAllocation.mockResolvedValue(
			Result.ok({ unlockedIds: ["s1", "s2"] }),
		);

		const result = await (markOnboardingComplete as () => Promise<unknown>)();

		expect(result).toEqual({
			status: "completed_now",
			onboarding: completePayload,
		});
		expect(mockGrantFreeAllocation).toHaveBeenCalledWith(
			fakeClient,
			"acct-free-1",
		);
	});

	it("does not grant free allocation for users with unlimited access", async () => {
		mockReadBillingState.mockResolvedValue(
			Result.ok(
				makeBillingState({ unlimitedAccess: { kind: "subscription" } }),
			),
		);

		const result = await (markOnboardingComplete as () => Promise<unknown>)();

		expect(result).toEqual({
			status: "completed_now",
			onboarding: completePayload,
		});
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

		expect(result).toEqual({
			status: "completed_now",
			onboarding: completePayload,
		});
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

		expect(result).toEqual({
			status: "completed_now",
			onboarding: completePayload,
		});
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

		expect(result).toEqual({
			status: "completed_now",
			onboarding: completePayload,
		});
		expect(mockGrantFreeAllocation).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalled();

		consoleSpy.mockRestore();
	});

	it("returns already_complete when the compare-and-set write is lost to a concurrent call", async () => {
		// Gate sees plan-selection, but completeOnboarding reports ok(null):
		// another request flipped onboarding_completed_at between the read and
		// the write. The post-write session reload shows complete.
		mockCompleteOnboarding.mockResolvedValue(Result.ok(null));

		const result = await (markOnboardingComplete as () => Promise<unknown>)();

		expect(result).toEqual({
			status: "already_complete",
			onboarding: completePayload,
		});
		// The losing call must not have run any allocation side effects.
		expect(mockReadBillingState).not.toHaveBeenCalled();
		expect(mockGrantFreeAllocation).not.toHaveBeenCalled();
	});

	it("returns already_complete without re-running allocations when already done", async () => {
		const alreadyCompletePayload = {
			session: { status: "complete" as const },
			theme: null,
		};
		mockLoadOnboardingSession.mockReset();
		mockLoadOnboardingSession.mockResolvedValueOnce(alreadyCompletePayload);

		const result = await (markOnboardingComplete as () => Promise<unknown>)();

		expect(result).toEqual({
			status: "already_complete",
			onboarding: alreadyCompletePayload,
		});
		expect(mockCompleteOnboarding).not.toHaveBeenCalled();
		expect(mockGrantFreeAllocation).not.toHaveBeenCalled();
	});

	it("returns not_ready when session is not at plan-selection", async () => {
		const welcomePayload = {
			session: { status: "welcome" as const },
			theme: null,
		};
		mockLoadOnboardingSession.mockReset();
		mockLoadOnboardingSession.mockResolvedValueOnce(welcomePayload);

		const result = await (markOnboardingComplete as () => Promise<unknown>)();

		expect(result).toEqual({
			status: "not_ready",
			onboarding: welcomePayload,
		});
		expect(mockCompleteOnboarding).not.toHaveBeenCalled();
	});
});

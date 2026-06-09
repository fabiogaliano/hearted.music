import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock auth context — overridden per-describe/test as needed.
// ---------------------------------------------------------------------------

const mockAuthContext = {
	session: { accountId: "acct-1" },
	account: { handle: null as string | null },
};

// ---------------------------------------------------------------------------
// Mock @tanstack/react-start — mirrors the pattern in onboarding tests.
// Replaces the builder so the exported fn is directly callable with { data }.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Domain-layer mocks
// ---------------------------------------------------------------------------

const mockValidateHandleFormatInput = vi.fn();
const mockIsReservedHandle = vi.fn();
const mockIsProfaneHandle = vi.fn();

vi.mock("@/lib/domains/library/accounts/handle-rules", () => ({
	validateHandleFormatInput: (raw: string) =>
		mockValidateHandleFormatInput(raw),
	isReservedHandle: (h: string) => mockIsReservedHandle(h),
}));

vi.mock("@/lib/domains/library/accounts/handle-profanity", () => ({
	isProfaneHandle: (h: string) => mockIsProfaneHandle(h),
}));

// ---------------------------------------------------------------------------
// Onboarding-session mock
// ---------------------------------------------------------------------------

const mockLoadOnboardingSession = vi.fn();

vi.mock("@/lib/server/onboarding-session", () => ({
	loadOnboardingSession: (...args: unknown[]) =>
		mockLoadOnboardingSession(...args),
	deriveAuthPayloadFromPrefs: vi.fn(),
}));

// ---------------------------------------------------------------------------
// isOnboardingStepBefore mock (used by claimHandleAndAdvance not_ready gate)
// ---------------------------------------------------------------------------

const mockIsOnboardingStepBefore = vi.fn();

vi.mock("@/lib/domains/library/accounts/onboarding-steps", () => ({
	isOnboardingStepBefore: (...args: unknown[]) =>
		mockIsOnboardingStepBefore(...args),
	ONBOARDING_STEP_VALUES: [
		"welcome",
		"pick-color",
		"install-extension",
		"syncing",
		"claim-handle",
		"flag-playlists",
		"pick-demo-song",
		"song-walkthrough",
		"match-walkthrough",
		"plan-selection",
		"complete",
	],
}));

// ---------------------------------------------------------------------------
// Supabase admin client mock
// ---------------------------------------------------------------------------

const mockRpc = vi.fn();
const mockFromAccount = vi.fn();

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		from: (table: string) => mockFromAccount(table),
		rpc: (...args: unknown[]) => mockRpc(...args),
	}),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOnboardingPayload(status: string) {
	return { session: { status }, theme: null };
}

function validFormat(handle: string) {
	mockValidateHandleFormatInput.mockReturnValue({
		status: "valid",
		normalizedHandle: handle,
	});
}

function invalidFormat(reason: string) {
	mockValidateHandleFormatInput.mockReturnValue({ status: "invalid", reason });
}

// ---------------------------------------------------------------------------
// Deferred import (after all mocks are declared)
// ---------------------------------------------------------------------------

import {
	checkHandleAvailability,
	claimHandleAndAdvance,
} from "../account-handle.functions";

// ---------------------------------------------------------------------------
// checkHandleAvailability
// ---------------------------------------------------------------------------

describe("checkHandleAvailability", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthContext.account.handle = null;
		// Default: handle is not reserved and not profane
		mockIsReservedHandle.mockReturnValue(false);
		mockIsProfaneHandle.mockReturnValue(false);
	});

	it("returns unavailable with reason on format failure (empty)", async () => {
		invalidFormat("empty");

		const result = await (
			checkHandleAvailability as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "" } });

		expect(result).toEqual({ status: "unavailable", reason: "empty" });
		expect(mockIsReservedHandle).not.toHaveBeenCalled();
	});

	it("returns unavailable with reason on format failure (contains_at_sign)", async () => {
		invalidFormat("contains_at_sign");

		const result = await (
			checkHandleAvailability as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "@help" } });

		expect(result).toEqual({
			status: "unavailable",
			reason: "contains_at_sign",
		});
	});

	it("returns unavailable:invalid_chars for whitespace input (whitespace becomes invalid_chars, not already_owned)", async () => {
		// Whitespace in handle → invalid_chars before any account-handle check
		invalidFormat("invalid_chars");

		const result = await (
			checkHandleAvailability as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "foo bar" } });

		expect(result).toEqual({ status: "unavailable", reason: "invalid_chars" });
		// Should not have checked account.handle at all
		expect(mockLoadOnboardingSession).not.toHaveBeenCalled();
	});

	it("returns available immediately on self-owned exact match (skips reserved/profanity/taken)", async () => {
		mockAuthContext.account.handle = "myhandle";
		validFormat("myhandle");

		const result = await (
			checkHandleAvailability as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "myhandle" } });

		expect(result).toEqual({ status: "available" });
		// No reserved/profanity/DB checks performed
		expect(mockIsReservedHandle).not.toHaveBeenCalled();
		expect(mockIsProfaneHandle).not.toHaveBeenCalled();
		expect(mockFromAccount).not.toHaveBeenCalled();
	});

	it("returns already_owned with recovery payload when account owns different handle", async () => {
		mockAuthContext.account.handle = "existinghandle";
		validFormat("differenthandle");

		const recoveryPayload = makeOnboardingPayload("claim-handle");
		mockLoadOnboardingSession.mockResolvedValue(recoveryPayload);

		const result = await (
			checkHandleAvailability as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "differenthandle" } });

		expect(result).toEqual({
			status: "already_owned",
			ownedHandle: "existinghandle",
			onboarding: recoveryPayload,
		});
		expect(mockLoadOnboardingSession).toHaveBeenCalledWith({
			accountId: "acct-1",
			accountHandle: "existinghandle",
		});
	});

	it("returns unavailable:reserved when handle is reserved", async () => {
		validFormat("admin");
		mockIsReservedHandle.mockReturnValue(true);

		const result = await (
			checkHandleAvailability as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "admin" } });

		expect(result).toEqual({ status: "unavailable", reason: "reserved" });
		expect(mockIsProfaneHandle).not.toHaveBeenCalled();
	});

	it("returns unavailable:profanity when handle is profane", async () => {
		validFormat("badword");
		mockIsReservedHandle.mockReturnValue(false);
		mockIsProfaneHandle.mockReturnValue(true);

		const result = await (
			checkHandleAvailability as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "badword" } });

		expect(result).toEqual({ status: "unavailable", reason: "profanity" });
	});

	it("returns unavailable:taken when another account owns the handle", async () => {
		validFormat("takenhandle");

		// DB returns a matching row for another account
		mockFromAccount.mockReturnValue({
			select: () => ({
				eq: () => ({
					neq: () => ({
						limit: () => ({
							maybeSingle: () =>
								Promise.resolve({ data: { id: "other-acct" }, error: null }),
						}),
					}),
				}),
			}),
		});

		const result = await (
			checkHandleAvailability as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "takenhandle" } });

		expect(result).toEqual({ status: "unavailable", reason: "taken" });
	});

	it("returns available when no other account owns the handle", async () => {
		validFormat("freehandle");

		mockFromAccount.mockReturnValue({
			select: () => ({
				eq: () => ({
					neq: () => ({
						limit: () => ({
							maybeSingle: () => Promise.resolve({ data: null, error: null }),
						}),
					}),
				}),
			}),
		});

		const result = await (
			checkHandleAvailability as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "freehandle" } });

		expect(result).toEqual({ status: "available" });
	});

	it("returns error (not throw) on DB failure", async () => {
		validFormat("somehandle");

		mockFromAccount.mockReturnValue({
			select: () => ({
				eq: () => ({
					neq: () => ({
						limit: () => ({
							maybeSingle: () =>
								Promise.resolve({
									data: null,
									error: { code: "PGRST999", message: "connection refused" },
								}),
						}),
					}),
				}),
			}),
		});

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await (
			checkHandleAvailability as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "somehandle" } });

		expect(result).toEqual({ status: "error" });
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("returns error (not throw) when loadOnboardingSession throws for already_owned recovery", async () => {
		mockAuthContext.account.handle = "existinghandle";
		validFormat("differenthandle");

		mockLoadOnboardingSession.mockRejectedValue(new Error("db fail"));

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await (
			checkHandleAvailability as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "differenthandle" } });

		expect(result).toEqual({ status: "error" });
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// claimHandleAndAdvance
// ---------------------------------------------------------------------------

describe("claimHandleAndAdvance", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthContext.account.handle = null;
		mockIsReservedHandle.mockReturnValue(false);
		mockIsProfaneHandle.mockReturnValue(false);
		// Default: step is NOT before claim-handle (i.e. ready)
		mockIsOnboardingStepBefore.mockReturnValue(false);
	});

	it("returns unavailable:empty on format failure", async () => {
		invalidFormat("empty");

		const result = await (
			claimHandleAndAdvance as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "" } });

		expect(result).toEqual({ status: "unavailable", reason: "empty" });
	});

	it("returns unavailable:invalid_chars for whitespace before already_owned check", async () => {
		// Whitespace → invalid_chars before the account.handle check
		mockAuthContext.account.handle = "somehandle";
		invalidFormat("invalid_chars");

		const result = await (
			claimHandleAndAdvance as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "foo bar" } });

		expect(result).toEqual({ status: "unavailable", reason: "invalid_chars" });
		expect(mockLoadOnboardingSession).not.toHaveBeenCalled();
	});

	it("returns not_ready when step is before claim-handle", async () => {
		validFormat("newhandle");
		// No handle, step earlier than claim-handle
		const earlyPayload = makeOnboardingPayload("syncing");
		mockLoadOnboardingSession.mockResolvedValue(earlyPayload);
		mockIsOnboardingStepBefore.mockReturnValue(true);

		const result = await (
			claimHandleAndAdvance as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "newhandle" } });

		expect(result).toEqual({ status: "not_ready", onboarding: earlyPayload });
		expect(mockRpc).not.toHaveBeenCalled();
	});

	it("returns already_owned when account already has a different handle", async () => {
		mockAuthContext.account.handle = "myhandle";
		validFormat("otherhandle");

		const recoveryPayload = makeOnboardingPayload("flag-playlists");
		mockLoadOnboardingSession.mockResolvedValue(recoveryPayload);

		const result = await (
			claimHandleAndAdvance as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "otherhandle" } });

		expect(result).toEqual({
			status: "already_owned",
			ownedHandle: "myhandle",
			onboarding: recoveryPayload,
		});
		expect(mockRpc).not.toHaveBeenCalled();
	});

	it("skips reserved/profanity checks on same-handle idempotent path", async () => {
		mockAuthContext.account.handle = "admin";
		validFormat("admin");
		// Even if "admin" would be reserved, the idempotent path skips the check
		mockIsReservedHandle.mockReturnValue(true);

		const claimedPayload = makeOnboardingPayload("flag-playlists");
		mockLoadOnboardingSession.mockResolvedValue(claimedPayload);

		mockRpc.mockReturnValue({
			single: () =>
				Promise.resolve({
					data: { status: "claimed", owned_handle: "admin" },
					error: null,
				}),
		});

		const result = await (
			claimHandleAndAdvance as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "admin" } });

		// Reserved check was skipped because account already owns the handle
		expect(mockIsReservedHandle).not.toHaveBeenCalled();
		expect(result).toMatchObject({ status: "claimed", ownedHandle: "admin" });
	});

	it("returns unavailable:reserved on first-claim path", async () => {
		validFormat("admin");
		// No handle — first-claim path
		const readyPayload = makeOnboardingPayload("claim-handle");
		mockLoadOnboardingSession.mockResolvedValue(readyPayload);
		mockIsOnboardingStepBefore.mockReturnValue(false);
		mockIsReservedHandle.mockReturnValue(true);

		const result = await (
			claimHandleAndAdvance as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "admin" } });

		expect(result).toEqual({ status: "unavailable", reason: "reserved" });
		expect(mockRpc).not.toHaveBeenCalled();
	});

	it("returns unavailable:profanity on first-claim path", async () => {
		validFormat("badword");
		const readyPayload = makeOnboardingPayload("claim-handle");
		mockLoadOnboardingSession.mockResolvedValue(readyPayload);
		mockIsOnboardingStepBefore.mockReturnValue(false);
		mockIsProfaneHandle.mockReturnValue(true);

		const result = await (
			claimHandleAndAdvance as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "badword" } });

		expect(result).toEqual({ status: "unavailable", reason: "profanity" });
		expect(mockRpc).not.toHaveBeenCalled();
	});

	it("returns unavailable:taken on RPC 23505 error", async () => {
		validFormat("newhandle");
		const readyPayload = makeOnboardingPayload("claim-handle");
		mockLoadOnboardingSession.mockResolvedValue(readyPayload);
		mockIsOnboardingStepBefore.mockReturnValue(false);

		mockRpc.mockReturnValue({
			single: () =>
				Promise.resolve({
					data: null,
					error: { code: "23505", message: "duplicate key" },
				}),
		});

		const result = await (
			claimHandleAndAdvance as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "newhandle" } });

		expect(result).toEqual({ status: "unavailable", reason: "taken" });
	});

	it("throws on non-23505 RPC error", async () => {
		validFormat("newhandle");
		const readyPayload = makeOnboardingPayload("claim-handle");
		mockLoadOnboardingSession.mockResolvedValue(readyPayload);
		mockIsOnboardingStepBefore.mockReturnValue(false);

		const rpcError = { code: "PGRST999", message: "connection refused" };
		mockRpc.mockReturnValue({
			single: () => Promise.resolve({ data: null, error: rpcError }),
		});

		await expect(
			(
				claimHandleAndAdvance as (opts: {
					data: { handle: string };
				}) => Promise<unknown>
			)({ data: { handle: "newhandle" } }),
		).rejects.toEqual(rpcError);
	});

	it("returns claimed with ownedHandle from RPC row (not stale context)", async () => {
		validFormat("mynewhandle");
		// account.handle is null — first claim
		const readyPayload = makeOnboardingPayload("claim-handle");
		const claimedPayload = makeOnboardingPayload("flag-playlists");

		// First call: load session for not_ready gate check
		// Second call: after claimed, load fresh session
		mockLoadOnboardingSession
			.mockResolvedValueOnce(readyPayload)
			.mockResolvedValueOnce(claimedPayload);
		mockIsOnboardingStepBefore.mockReturnValue(false);

		mockRpc.mockReturnValue({
			single: () =>
				Promise.resolve({
					data: { status: "claimed", owned_handle: "mynewhandle" },
					error: null,
				}),
		});

		const result = await (
			claimHandleAndAdvance as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "mynewhandle" } });

		expect(result).toEqual({
			status: "claimed",
			ownedHandle: "mynewhandle",
			onboarding: claimedPayload,
		});
		// loadOnboardingSession for the post-claim session uses the RPC-returned handle
		expect(mockLoadOnboardingSession).toHaveBeenLastCalledWith({
			accountId: "acct-1",
			accountHandle: "mynewhandle",
		});
	});

	it("maps RPC already_owned row to already_owned result with recovery payload", async () => {
		validFormat("somehandle");
		const readyPayload = makeOnboardingPayload("claim-handle");
		const alreadyOwnedPayload = makeOnboardingPayload("flag-playlists");

		mockLoadOnboardingSession
			.mockResolvedValueOnce(readyPayload)
			.mockResolvedValueOnce(alreadyOwnedPayload);
		mockIsOnboardingStepBefore.mockReturnValue(false);

		mockRpc.mockReturnValue({
			single: () =>
				Promise.resolve({
					data: { status: "already_owned", owned_handle: "somehandle" },
					error: null,
				}),
		});

		const result = await (
			claimHandleAndAdvance as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "somehandle" } });

		expect(result).toEqual({
			status: "already_owned",
			ownedHandle: "somehandle",
			onboarding: alreadyOwnedPayload,
		});
		// recovery payload must use the RPC-returned owned_handle, not stale context/null
		expect(mockLoadOnboardingSession).toHaveBeenLastCalledWith({
			accountId: "acct-1",
			accountHandle: "somehandle",
		});
	});

	it("maps RPC not_ready row to not_ready result with null accountHandle", async () => {
		validFormat("somehandle");
		const readyPayload = makeOnboardingPayload("claim-handle");
		const notReadyPayload = makeOnboardingPayload("syncing");

		mockLoadOnboardingSession
			.mockResolvedValueOnce(readyPayload)
			.mockResolvedValueOnce(notReadyPayload);
		mockIsOnboardingStepBefore.mockReturnValue(false);

		mockRpc.mockReturnValue({
			single: () =>
				Promise.resolve({
					// null owned_handle on not_ready — real runtime shape despite generated type
					data: { status: "not_ready", owned_handle: null },
					error: null,
				}),
		});

		const result = await (
			claimHandleAndAdvance as (opts: {
				data: { handle: string };
			}) => Promise<unknown>
		)({ data: { handle: "somehandle" } });

		expect(result).toEqual({
			status: "not_ready",
			onboarding: notReadyPayload,
		});
		expect(mockLoadOnboardingSession).toHaveBeenLastCalledWith({
			accountId: "acct-1",
			accountHandle: null,
		});
	});

	it("throws on malformed/missing RPC data (operational failure)", async () => {
		validFormat("somehandle");
		const readyPayload = makeOnboardingPayload("claim-handle");
		mockLoadOnboardingSession.mockResolvedValue(readyPayload);
		mockIsOnboardingStepBefore.mockReturnValue(false);

		mockRpc.mockReturnValue({
			single: () =>
				Promise.resolve({
					// Shape-invalid row — missing status field
					data: { owned_handle: "somehandle" },
					error: null,
				}),
		});

		await expect(
			(
				claimHandleAndAdvance as (opts: {
					data: { handle: string };
				}) => Promise<unknown>
			)({ data: { handle: "somehandle" } }),
		).rejects.toThrow();
	});
});

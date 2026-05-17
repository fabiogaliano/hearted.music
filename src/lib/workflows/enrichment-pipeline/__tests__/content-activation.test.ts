import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingState } from "@/lib/domains/billing/state";

// --- Mocks ---

const mockReadBillingState = vi.fn();
const mockMarkItemsNew = vi.fn();
const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		rpc: (...args: unknown[]) => mockRpc(...args),
		from: (...args: unknown[]) => mockFrom(...args),
	}),
}));

vi.mock("@/lib/domains/billing/queries", () => ({
	readBillingState: (...args: unknown[]) => mockReadBillingState(...args),
}));

vi.mock("@/lib/domains/library/liked-songs/status-queries", () => ({
	markItemsNew: (...args: unknown[]) => mockMarkItemsNew(...args),
}));

import { FAILURE_CODES } from "../failure-policy";
import { runContentActivation } from "../stages/content-activation";
import type { EnrichmentContext } from "../types";

// --- Helpers ---

function makeCtx(accountId = "account-1"): EnrichmentContext {
	return {
		accountId,
		embeddingService: {} as EnrichmentContext["embeddingService"],
		profilingService: {} as EnrichmentContext["profilingService"],
	};
}

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

function mockAccountBillingSelect(
	row: {
		stripe_subscription_id: string | null;
		subscription_period_end: string | null;
	} | null,
) {
	mockFrom.mockReturnValue({
		select: () => ({
			eq: () => ({
				single: () =>
					Promise.resolve({
						data: row,
						error: null,
					}),
			}),
		}),
	});
}

// --- Tests ---

beforeEach(() => {
	vi.clearAllMocks();
	mockMarkItemsNew.mockResolvedValue(Result.ok([]));
	mockRpc.mockResolvedValue({ data: [], error: null });
});

describe("runContentActivation", () => {
	it("returns skipped outcome when songIds is empty", async () => {
		const outcome = await runContentActivation(makeCtx(), []);

		expect(outcome.kind).toBe("skipped");
		expect(mockReadBillingState).not.toHaveBeenCalled();
		expect(mockMarkItemsNew).not.toHaveBeenCalled();
	});

	describe("free/pack users (unlimitedAccess: none)", () => {
		it("succeeds all songs via markItemsNew", async () => {
			mockReadBillingState.mockResolvedValue(
				Result.ok(makeBillingState({ unlimitedAccess: { kind: "none" } })),
			);

			const outcome = await runContentActivation(makeCtx(), [
				"song-1",
				"song-2",
			]);

			expect(outcome.kind).toBe("attempted");
			if (outcome.kind !== "attempted") return;

			expect(outcome.succeededSongIds).toEqual(["song-1", "song-2"]);
			expect(outcome.failures).toEqual([]);
			expect(mockMarkItemsNew).toHaveBeenCalledWith("account-1", "song", [
				"song-1",
				"song-2",
			]);
			expect(mockRpc).not.toHaveBeenCalled();
		});

		it("returns failures when markItemsNew fails", async () => {
			mockReadBillingState.mockResolvedValue(
				Result.ok(makeBillingState({ unlimitedAccess: { kind: "none" } })),
			);
			mockMarkItemsNew.mockResolvedValue(Result.err({ message: "db timeout" }));

			const outcome = await runContentActivation(makeCtx(), [
				"song-1",
				"song-2",
			]);

			expect(outcome.kind).toBe("attempted");
			if (outcome.kind !== "attempted") return;

			expect(outcome.succeededSongIds).toEqual([]);
			expect(outcome.failures).toHaveLength(2);
			expect(outcome.failures[0].failureCode).toBe(
				FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
			);
			expect(outcome.failures[0].message).toContain(
				"account_item_newness write failed",
			);
		});
	});

	describe("unlimited subscription users", () => {
		it("succeeds all songs via activate_unlimited_songs RPC", async () => {
			mockReadBillingState.mockResolvedValue(
				Result.ok(
					makeBillingState({
						unlimitedAccess: { kind: "subscription" },
						subscriptionStatus: "active",
					}),
				),
			);

			mockAccountBillingSelect({
				stripe_subscription_id: "sub_123",
				subscription_period_end: "2026-07-01T00:00:00Z",
			});

			const outcome = await runContentActivation(makeCtx(), [
				"song-1",
				"song-2",
			]);

			expect(outcome.kind).toBe("attempted");
			if (outcome.kind !== "attempted") return;

			expect(outcome.succeededSongIds).toEqual(["song-1", "song-2"]);
			expect(outcome.failures).toEqual([]);
			expect(mockRpc).toHaveBeenCalledWith("activate_unlimited_songs", {
				p_account_id: "account-1",
				p_granted_stripe_subscription_id: "sub_123",
				p_granted_subscription_period_end: "2026-07-01T00:00:00Z",
			});
			expect(mockMarkItemsNew).not.toHaveBeenCalled();
		});

		it("returns retryable failures when subscription provenance is missing", async () => {
			mockReadBillingState.mockResolvedValue(
				Result.ok(
					makeBillingState({
						unlimitedAccess: { kind: "subscription" },
					}),
				),
			);

			mockAccountBillingSelect({
				stripe_subscription_id: null,
				subscription_period_end: null,
			});

			const outcome = await runContentActivation(makeCtx(), ["song-1"]);

			expect(outcome.kind).toBe("attempted");
			if (outcome.kind !== "attempted") return;

			expect(outcome.succeededSongIds).toEqual([]);
			expect(outcome.failures).toHaveLength(1);
			expect(outcome.failures[0].failureCode).toBe(
				FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
			);
			expect(outcome.failures[0].message).toContain(
				"Missing subscription provenance",
			);
			expect(mockMarkItemsNew).not.toHaveBeenCalled();
			expect(mockRpc).not.toHaveBeenCalledWith(
				"activate_unlimited_songs",
				expect.anything(),
			);
		});

		it("returns failures when RPC errors", async () => {
			mockReadBillingState.mockResolvedValue(
				Result.ok(
					makeBillingState({
						unlimitedAccess: { kind: "subscription" },
					}),
				),
			);

			mockAccountBillingSelect({
				stripe_subscription_id: "sub_123",
				subscription_period_end: "2026-07-01T00:00:00Z",
			});

			mockRpc.mockResolvedValue({
				data: null,
				error: { message: "rpc timeout" },
			});

			const outcome = await runContentActivation(makeCtx(), [
				"song-1",
				"song-2",
			]);

			expect(outcome.kind).toBe("attempted");
			if (outcome.kind !== "attempted") return;

			expect(outcome.succeededSongIds).toEqual([]);
			expect(outcome.failures).toHaveLength(2);
			expect(outcome.failures[0].failureCode).toBe(
				FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
			);
			expect(outcome.failures[0].message).toContain(
				"activate_unlimited_songs RPC failed",
			);
		});
	});

	describe("self-hosted users", () => {
		it("succeeds when both account_item_newness and unlock-row persist", async () => {
			mockReadBillingState.mockResolvedValue(
				Result.ok(
					makeBillingState({
						unlimitedAccess: { kind: "self_hosted" },
					}),
				),
			);

			const outcome = await runContentActivation(makeCtx(), [
				"song-1",
				"song-2",
			]);

			expect(outcome.kind).toBe("attempted");
			if (outcome.kind !== "attempted") return;

			expect(outcome.succeededSongIds).toEqual(["song-1", "song-2"]);
			expect(outcome.failures).toEqual([]);
			expect(mockMarkItemsNew).toHaveBeenCalledWith("account-1", "song", [
				"song-1",
				"song-2",
			]);
			expect(mockRpc).toHaveBeenCalledWith(
				"insert_song_unlocks_without_charge",
				{
					p_account_id: "account-1",
					p_song_ids: ["song-1", "song-2"],
					p_source: "self_hosted",
				},
			);
		});

		it("returns failures when unlock rows persist but markItemsNew fails", async () => {
			mockReadBillingState.mockResolvedValue(
				Result.ok(
					makeBillingState({
						unlimitedAccess: { kind: "self_hosted" },
					}),
				),
			);
			mockMarkItemsNew.mockResolvedValue(
				Result.err({ message: "connection reset" }),
			);

			const outcome = await runContentActivation(makeCtx(), ["song-1"]);

			expect(outcome.kind).toBe("attempted");
			if (outcome.kind !== "attempted") return;

			expect(mockRpc).toHaveBeenCalledWith(
				"insert_song_unlocks_without_charge",
				{
					p_account_id: "account-1",
					p_song_ids: ["song-1"],
					p_source: "self_hosted",
				},
			);
			expect(outcome.succeededSongIds).toEqual([]);
			expect(outcome.failures[0].failureCode).toBe(
				FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
			);
			expect(outcome.failures[0].message).toContain(
				"account_item_newness write failed",
			);
		});

		it("returns failures and does not mark items new when unlock RPC fails", async () => {
			mockReadBillingState.mockResolvedValue(
				Result.ok(
					makeBillingState({
						unlimitedAccess: { kind: "self_hosted" },
					}),
				),
			);
			mockRpc.mockResolvedValue({
				data: null,
				error: { message: "rpc constraint violation" },
			});

			const outcome = await runContentActivation(makeCtx(), ["song-1"]);

			expect(outcome.kind).toBe("attempted");
			if (outcome.kind !== "attempted") return;

			expect(outcome.succeededSongIds).toEqual([]);
			expect(outcome.failures[0].failureCode).toBe(
				FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
			);
			expect(outcome.failures[0].message).toContain(
				"self_hosted unlock RPC failed",
			);
			expect(mockMarkItemsNew).not.toHaveBeenCalled();
		});
	});

	it("returns failures for all songs when billing state read fails", async () => {
		mockReadBillingState.mockResolvedValue(
			Result.err({ message: "db connection failed" }),
		);

		const outcome = await runContentActivation(makeCtx(), ["song-1", "song-2"]);

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") return;

		expect(outcome.succeededSongIds).toEqual([]);
		expect(outcome.failures).toHaveLength(2);
		expect(outcome.failures[0].failureCode).toBe(
			FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
		);
		expect(outcome.failures[0].message).toContain(
			"Failed to read billing state",
		);
		expect(mockMarkItemsNew).not.toHaveBeenCalled();
	});
});

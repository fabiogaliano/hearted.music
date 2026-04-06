import { describe, it, expect, vi, beforeEach } from "vitest";
import { Result } from "better-result";
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
	it("does nothing when songIds is empty", async () => {
		await runContentActivation(makeCtx(), []);

		expect(mockReadBillingState).not.toHaveBeenCalled();
		expect(mockMarkItemsNew).not.toHaveBeenCalled();
		expect(mockRpc).not.toHaveBeenCalled();
	});

	describe("free/pack users (unlimitedAccess: none)", () => {
		it("writes item_status via markItemsNew for entitled + analyzed songs", async () => {
			mockReadBillingState.mockResolvedValue(
				Result.ok(makeBillingState({ unlimitedAccess: { kind: "none" } })),
			);

			await runContentActivation(makeCtx(), ["song-1", "song-2"]);

			expect(mockMarkItemsNew).toHaveBeenCalledWith("account-1", "song", [
				"song-1",
				"song-2",
			]);
			expect(mockRpc).not.toHaveBeenCalled();
		});

		it("does not create unlock rows", async () => {
			mockReadBillingState.mockResolvedValue(
				Result.ok(makeBillingState({ unlimitedAccess: { kind: "none" } })),
			);

			await runContentActivation(makeCtx(), ["song-1"]);

			expect(mockRpc).not.toHaveBeenCalled();
		});
	});

	describe("unlimited subscription users", () => {
		it("calls activate_unlimited_songs with subscription provenance", async () => {
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

			await runContentActivation(makeCtx(), ["song-1", "song-2"]);

			expect(mockRpc).toHaveBeenCalledWith("activate_unlimited_songs", {
				p_account_id: "account-1",
				p_granted_stripe_subscription_id: "sub_123",
				p_granted_subscription_period_end: "2026-07-01T00:00:00Z",
			});
			expect(mockMarkItemsNew).not.toHaveBeenCalled();
		});

		it("falls back to markItemsNew when subscription provenance is missing", async () => {
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

			await runContentActivation(makeCtx(), ["song-1"]);

			expect(mockMarkItemsNew).toHaveBeenCalledWith("account-1", "song", [
				"song-1",
			]);
			expect(mockRpc).not.toHaveBeenCalledWith(
				"activate_unlimited_songs",
				expect.anything(),
			);
		});
	});

	describe("self-hosted users", () => {
		it("writes item_status and creates self_hosted unlock rows", async () => {
			mockReadBillingState.mockResolvedValue(
				Result.ok(
					makeBillingState({
						unlimitedAccess: { kind: "self_hosted" },
					}),
				),
			);

			await runContentActivation(makeCtx(), ["song-1", "song-2"]);

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
	});

	it("handles billing state read failure gracefully", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		mockReadBillingState.mockResolvedValue(
			Result.err({ message: "db connection failed" }),
		);

		await runContentActivation(makeCtx(), ["song-1"]);

		expect(mockMarkItemsNew).not.toHaveBeenCalled();
		expect(mockRpc).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledWith(
			expect.stringContaining("[content-activation]"),
			// message not checked — just verifying error is logged
		);

		consoleError.mockRestore();
	});
});

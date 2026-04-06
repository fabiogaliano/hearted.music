import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AdminSupabaseClient } from "@/lib/data/client";

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: vi.fn(),
}));

import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";
import {
	handlePackFulfilled,
	handleUnlimitedActivated,
	handlePackReversed,
	handleUnlimitedPeriodReversed,
	handleSubscriptionDeactivated,
} from "../bridge-handlers";

const mockedApplyChange = vi.mocked(applyLibraryProcessingChange);

function makeSupabase(overrides: Record<string, unknown> = {}) {
	return {
		from: vi.fn().mockReturnValue({
			insert: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					single: vi
						.fn()
						.mockResolvedValue({ data: { id: "test" }, error: null }),
				}),
			}),
		}),
		rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
		...overrides,
	} as unknown as AdminSupabaseClient;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("handlePackFulfilled", () => {
	it("emits songsUnlocked when bonus songs are present", async () => {
		const supabase = makeSupabase();
		await handlePackFulfilled(supabase, {
			accountId: "acc-1",
			bonusUnlockedSongIds: ["song-1", "song-2"],
		});

		expect(mockedApplyChange).toHaveBeenCalledOnce();
		expect(mockedApplyChange).toHaveBeenCalledWith({
			kind: "songs_unlocked",
			accountId: "acc-1",
			songIds: ["song-1", "song-2"],
		});
	});

	it("does not emit when bonus songs are empty", async () => {
		const supabase = makeSupabase();
		await handlePackFulfilled(supabase, {
			accountId: "acc-1",
			bonusUnlockedSongIds: [],
		});

		expect(mockedApplyChange).not.toHaveBeenCalled();
	});
});

describe("handleUnlimitedActivated", () => {
	it("inserts activation marker and emits unlimitedActivated", async () => {
		const insertMock = vi.fn().mockResolvedValue({
			data: { id: "test" },
			error: null,
		});
		const fromMock = vi.fn().mockReturnValue({ insert: insertMock });
		const supabase = makeSupabase({ from: fromMock });

		await handleUnlimitedActivated(supabase, {
			accountId: "acc-1",
			stripeSubscriptionId: "sub_123",
			subscriptionPeriodEnd: "2026-05-01T00:00:00Z",
			stripeEventId: "evt_1",
		});

		expect(fromMock).toHaveBeenCalledWith("billing_activation");
		expect(insertMock).toHaveBeenCalledWith({
			account_id: "acc-1",
			kind: "unlimited_period_activated",
			stripe_subscription_id: "sub_123",
			subscription_period_end: "2026-05-01T00:00:00Z",
			stripe_event_id: "evt_1",
		});
		expect(mockedApplyChange).toHaveBeenCalledOnce();
		expect(mockedApplyChange).toHaveBeenCalledWith({
			kind: "unlimited_activated",
			accountId: "acc-1",
		});
	});

	it("does not re-emit on duplicate activation (UNIQUE constraint violation)", async () => {
		const insertMock = vi.fn().mockResolvedValue({
			data: null,
			error: { code: "23505", message: "duplicate key" },
		});
		const fromMock = vi.fn().mockReturnValue({ insert: insertMock });
		const supabase = makeSupabase({ from: fromMock });

		await handleUnlimitedActivated(supabase, {
			accountId: "acc-1",
			stripeSubscriptionId: "sub_123",
			subscriptionPeriodEnd: "2026-05-01T00:00:00Z",
			stripeEventId: "evt_2",
		});

		expect(mockedApplyChange).not.toHaveBeenCalled();
	});

	it("throws on non-duplicate database errors", async () => {
		const insertMock = vi.fn().mockResolvedValue({
			data: null,
			error: { code: "42000", message: "some other error" },
		});
		const fromMock = vi.fn().mockReturnValue({ insert: insertMock });
		const supabase = makeSupabase({ from: fromMock });

		await expect(
			handleUnlimitedActivated(supabase, {
				accountId: "acc-1",
				stripeSubscriptionId: "sub_123",
				subscriptionPeriodEnd: "2026-05-01T00:00:00Z",
				stripeEventId: "evt_3",
			}),
		).rejects.toThrow("Failed to insert billing_activation");
	});
});

describe("handlePackReversed", () => {
	it("emits candidateAccessRevoked when songs were revoked", async () => {
		const supabase = makeSupabase({
			rpc: vi.fn().mockResolvedValue({
				data: { credits_reversed: 5, revoked_song_ids: ["s1", "s2"] },
				error: null,
			}),
		});

		await handlePackReversed(supabase, {
			accountId: "acc-1",
			packStripeEventId: "evt_pack",
			stripeEventId: "evt_refund",
			reason: "refund",
		});

		expect(mockedApplyChange).toHaveBeenCalledOnce();
		expect(mockedApplyChange).toHaveBeenCalledWith({
			kind: "candidate_access_revoked",
			accountId: "acc-1",
		});
	});

	it("does not emit when no songs were revoked", async () => {
		const supabase = makeSupabase({
			rpc: vi.fn().mockResolvedValue({
				data: { credits_reversed: 5, revoked_song_ids: [] },
				error: null,
			}),
		});

		await handlePackReversed(supabase, {
			accountId: "acc-1",
			packStripeEventId: "evt_pack",
			stripeEventId: "evt_refund",
			reason: "refund",
		});

		expect(mockedApplyChange).not.toHaveBeenCalled();
	});

	it("throws on RPC error", async () => {
		const supabase = makeSupabase({
			rpc: vi
				.fn()
				.mockResolvedValue({ data: null, error: { message: "rpc fail" } }),
		});

		await expect(
			handlePackReversed(supabase, {
				accountId: "acc-1",
				packStripeEventId: "evt_pack",
				stripeEventId: "evt_refund",
				reason: "chargeback",
			}),
		).rejects.toThrow("reverse_pack_entitlement failed");
	});
});

describe("handleUnlimitedPeriodReversed", () => {
	it("emits candidateAccessRevoked when songs were revoked", async () => {
		const supabase = makeSupabase({
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "s1" }, { song_id: "s2" }],
				error: null,
			}),
		});

		await handleUnlimitedPeriodReversed(supabase, {
			accountId: "acc-1",
			stripeSubscriptionId: "sub_123",
			subscriptionPeriodEnd: "2026-05-01T00:00:00Z",
			stripeEventId: "evt_refund",
			reason: "refund",
		});

		expect(mockedApplyChange).toHaveBeenCalledOnce();
		expect(mockedApplyChange).toHaveBeenCalledWith({
			kind: "candidate_access_revoked",
			accountId: "acc-1",
		});
	});

	it("does not emit when no songs were revoked", async () => {
		const supabase = makeSupabase({
			rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
		});

		await handleUnlimitedPeriodReversed(supabase, {
			accountId: "acc-1",
			stripeSubscriptionId: "sub_123",
			subscriptionPeriodEnd: "2026-05-01T00:00:00Z",
			stripeEventId: "evt_refund",
			reason: "chargeback",
		});

		expect(mockedApplyChange).not.toHaveBeenCalled();
	});

	it("throws on RPC error", async () => {
		const supabase = makeSupabase({
			rpc: vi
				.fn()
				.mockResolvedValue({ data: null, error: { message: "rpc fail" } }),
		});

		await expect(
			handleUnlimitedPeriodReversed(supabase, {
				accountId: "acc-1",
				stripeSubscriptionId: "sub_123",
				subscriptionPeriodEnd: "2026-05-01T00:00:00Z",
				stripeEventId: "evt_refund",
				reason: "refund",
			}),
		).rejects.toThrow("reverse_unlimited_period_entitlement failed");
	});
});

describe("handleSubscriptionDeactivated", () => {
	it("always emits candidateAccessRevoked", async () => {
		await handleSubscriptionDeactivated("acc-1");

		expect(mockedApplyChange).toHaveBeenCalledOnce();
		expect(mockedApplyChange).toHaveBeenCalledWith({
			kind: "candidate_access_revoked",
			accountId: "acc-1",
		});
	});
});

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSupabaseClient } from "@/lib/data/client";

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: vi.fn().mockResolvedValue(
		Result.ok({
			accountId: "acct-1",
			changeKind: "songs_unlocked",
			state: {
				accountId: "acct-1",
				enrichment: { requestedAt: null, settledAt: null, activeJobId: null },
				matchSnapshotRefresh: {
					requestedAt: null,
					settledAt: null,
					activeJobId: null,
				},
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			effects: [],
			effectResults: [],
		}),
	),
}));

import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";
import {
	handlePackFulfilled,
	handlePackReversed,
	handleSubscriptionDeactivated,
	handleUnlimitedActivated,
	handleUnlimitedPeriodReversed,
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

	it("still emits on duplicate activation so retries re-drive the apply", async () => {
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

		expect(mockedApplyChange).toHaveBeenCalledOnce();
		expect(mockedApplyChange).toHaveBeenCalledWith({
			kind: "unlimited_activated",
			accountId: "acc-1",
		});
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
	it("emits candidateAccessRevoked when accessRemoved is true", async () => {
		await handlePackReversed({
			accountId: "acc-1",
			accessRemoved: true,
		});

		expect(mockedApplyChange).toHaveBeenCalledOnce();
		expect(mockedApplyChange).toHaveBeenCalledWith({
			kind: "candidate_access_revoked",
			accountId: "acc-1",
		});
	});

	it("does nothing when accessRemoved is false", async () => {
		await handlePackReversed({
			accountId: "acc-1",
			accessRemoved: false,
		});

		expect(mockedApplyChange).not.toHaveBeenCalled();
	});
});

describe("handleUnlimitedPeriodReversed", () => {
	it("emits candidateAccessRevoked when accessRemoved is true", async () => {
		await handleUnlimitedPeriodReversed({
			accountId: "acc-1",
			accessRemoved: true,
		});

		expect(mockedApplyChange).toHaveBeenCalledOnce();
		expect(mockedApplyChange).toHaveBeenCalledWith({
			kind: "candidate_access_revoked",
			accountId: "acc-1",
		});
	});

	it("does nothing when accessRemoved is false", async () => {
		await handleUnlimitedPeriodReversed({
			accountId: "acc-1",
			accessRemoved: false,
		});

		expect(mockedApplyChange).not.toHaveBeenCalled();
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

describe("apply failure propagation", () => {
	beforeEach(() => {
		mockedApplyChange.mockResolvedValue(
			Result.err({
				kind: "persist_state",
				cause: { message: "db down", code: "XX000" },
			} as never),
		);
	});

	it("handlePackFulfilled throws when apply fails", async () => {
		await expect(
			handlePackFulfilled(makeSupabase(), {
				accountId: "acc-1",
				bonusUnlockedSongIds: ["song-1"],
			}),
		).rejects.toThrow("library-processing apply failed (persist_state)");
	});

	it("handleUnlimitedActivated throws when apply fails", async () => {
		await expect(
			handleUnlimitedActivated(makeSupabase(), {
				accountId: "acc-1",
				stripeSubscriptionId: "sub_123",
				subscriptionPeriodEnd: "2026-05-01T00:00:00Z",
				stripeEventId: "evt_4",
			}),
		).rejects.toThrow("library-processing apply failed (persist_state)");
	});

	it("handlePackReversed throws when apply fails", async () => {
		await expect(
			handlePackReversed({ accountId: "acc-1", accessRemoved: true }),
		).rejects.toThrow("library-processing apply failed (persist_state)");
	});

	it("handleUnlimitedPeriodReversed throws when apply fails", async () => {
		await expect(
			handleUnlimitedPeriodReversed({
				accountId: "acc-1",
				accessRemoved: true,
			}),
		).rejects.toThrow("library-processing apply failed (persist_state)");
	});

	it("handleSubscriptionDeactivated throws when apply fails", async () => {
		await expect(handleSubscriptionDeactivated("acc-1")).rejects.toThrow(
			"library-processing apply failed (persist_state)",
		);
	});
});

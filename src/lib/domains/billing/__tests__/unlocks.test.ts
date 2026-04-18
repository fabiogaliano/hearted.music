import { describe, expect, it, vi, beforeEach } from "vitest";
import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";

vi.mock("@/lib/domains/billing/queries", () => ({
	readBillingState: vi.fn(),
}));

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: vi.fn(),
}));

import { readBillingState } from "@/lib/domains/billing/queries";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";
import { requestSongUnlock, grantFreeAllocation } from "../unlocks";
import type { BillingState } from "@/lib/domains/billing/state";

const mockedReadBillingState = vi.mocked(readBillingState);
const mockedApplyChange = vi.mocked(applyLibraryProcessingChange);

function makeBillingState(overrides: Partial<BillingState> = {}): BillingState {
	return {
		plan: "free",
		creditBalance: 10,
		subscriptionStatus: "none",
		cancelAtPeriodEnd: false,
		unlimitedAccess: { kind: "none" },
		queueBand: "standard",
		...overrides,
	};
}

function mockRpc(responses: Record<string, { data: unknown; error: unknown }>) {
	return vi.fn().mockImplementation((name: string) => {
		const resp = responses[name];
		if (resp) return Promise.resolve(resp);
		return Promise.resolve({
			data: null,
			error: { code: "UNKNOWN", message: "unknown rpc" },
		});
	});
}

function mockFrom(
	responses: Record<
		string,
		{
			selectResult?: { data: unknown; error: unknown };
		}
	>,
) {
	return vi.fn().mockImplementation((table: string) => {
		const config = responses[table];
		const selectResult = config?.selectResult ?? {
			data: [],
			error: null,
		};

		const limitFn = vi.fn().mockResolvedValue(selectResult);
		const orderFn = vi.fn().mockReturnValue({ limit: limitFn });
		const isFn = vi.fn().mockReturnValue({ order: orderFn });
		const eqFn = vi.fn().mockReturnValue({ is: isFn });
		const selectFn = vi.fn().mockReturnValue({ eq: eqFn });

		return { select: selectFn };
	});
}

describe("requestSongUnlock", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedApplyChange.mockResolvedValue(undefined);
	});

	it("returns structured result on successful unlock", async () => {
		mockedReadBillingState.mockResolvedValue(
			Result.ok(makeBillingState({ creditBalance: 5 })),
		);

		const rpcFn = mockRpc({
			unlock_songs_for_account: {
				data: {
					newly_unlocked_song_ids: ["s1", "s2"],
					already_unlocked_song_ids: ["s3"],
				},
				error: null,
			},
		});

		const client = {
			rpc: rpcFn,
		} as unknown as AdminSupabaseClient;

		const result = await requestSongUnlock(client, "acc-1", ["s1", "s2", "s3"]);

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value).toEqual({
			newlyUnlockedIds: ["s1", "s2"],
			alreadyUnlockedIds: ["s3"],
			remainingBalance: 3,
		});

		expect(rpcFn).toHaveBeenCalledWith("unlock_songs_for_account", {
			p_account_id: "acc-1",
			p_song_ids: ["s1", "s2", "s3"],
		});

		expect(mockedApplyChange).toHaveBeenCalledWith({
			kind: "songs_unlocked",
			accountId: "acc-1",
			songIds: ["s1", "s2"],
		});
	});

	it("returns insufficient_balance error", async () => {
		mockedReadBillingState.mockResolvedValue(
			Result.ok(makeBillingState({ creditBalance: 1 })),
		);

		const rpcFn = mockRpc({
			unlock_songs_for_account: {
				data: null,
				error: {
					code: "P0001",
					message: "insufficient balance (credit_balance=1, required=3)",
				},
			},
		});

		const client = { rpc: rpcFn } as unknown as AdminSupabaseClient;

		const result = await requestSongUnlock(client, "acc-1", ["s1", "s2", "s3"]);

		expect(Result.isError(result)).toBe(true);
		if (!Result.isError(result)) return;

		expect(result.error).toEqual({
			kind: "insufficient_balance",
			required: 3,
			available: 1,
		});
	});

	it("returns invalid_songs error when songs not currently liked", async () => {
		mockedReadBillingState.mockResolvedValue(
			Result.ok(makeBillingState({ creditBalance: 5 })),
		);

		const rpcFn = mockRpc({
			unlock_songs_for_account: {
				data: null,
				error: {
					code: "P0001",
					message: "Songs are not currently liked",
				},
			},
		});

		const client = { rpc: rpcFn } as unknown as AdminSupabaseClient;

		const result = await requestSongUnlock(client, "acc-1", ["s1"]);

		expect(Result.isError(result)).toBe(true);
		if (!Result.isError(result)) return;

		expect(result.error).toEqual({
			kind: "invalid_songs",
			songIds: ["s1"],
		});
	});

	it("returns unlimited_access_active when account has unlimited access", async () => {
		mockedReadBillingState.mockResolvedValue(
			Result.ok(
				makeBillingState({
					unlimitedAccess: { kind: "subscription" },
				}),
			),
		);

		const rpcFn = vi.fn();
		const client = { rpc: rpcFn } as unknown as AdminSupabaseClient;

		const result = await requestSongUnlock(client, "acc-1", ["s1"]);

		expect(Result.isError(result)).toBe(true);
		if (!Result.isError(result)) return;

		expect(result.error).toEqual({ kind: "unlimited_access_active" });
		expect(rpcFn).not.toHaveBeenCalled();
	});

	it("does not emit change when all songs already unlocked", async () => {
		mockedReadBillingState.mockResolvedValue(
			Result.ok(makeBillingState({ creditBalance: 5 })),
		);

		const rpcFn = mockRpc({
			unlock_songs_for_account: {
				data: {
					newly_unlocked_song_ids: [],
					already_unlocked_song_ids: ["s1", "s2"],
				},
				error: null,
			},
		});

		const client = { rpc: rpcFn } as unknown as AdminSupabaseClient;

		const result = await requestSongUnlock(client, "acc-1", ["s1", "s2"]);

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.newlyUnlockedIds).toEqual([]);
		expect(result.value.alreadyUnlockedIds).toEqual(["s1", "s2"]);
		expect(result.value.remainingBalance).toBe(5);
		expect(mockedApplyChange).not.toHaveBeenCalled();
	});

	it("returns db_error when readBillingState fails", async () => {
		const { DatabaseError } = await import("@/lib/shared/errors/database");
		mockedReadBillingState.mockResolvedValue(
			Result.err(
				new DatabaseError({ code: "FAIL", message: "connection lost" }),
			),
		);

		const client = {} as unknown as AdminSupabaseClient;

		const result = await requestSongUnlock(client, "acc-1", ["s1"]);

		expect(Result.isError(result)).toBe(true);
		if (!Result.isError(result)) return;

		expect(result.error.kind).toBe("db_error");
	});
});

describe("grantFreeAllocation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedApplyChange.mockResolvedValue(undefined);
	});

	it("unlocks up to 15 most-recent liked songs with source free_auto", async () => {
		const likedSongs = Array.from({ length: 15 }, (_, i) => ({
			song_id: `song-${i}`,
		}));
		const unlockedRows = likedSongs.map((s) => ({ song_id: s.song_id }));

		const fromFn = mockFrom({
			liked_song: {
				selectResult: { data: likedSongs, error: null },
			},
		});

		const rpcFn = mockRpc({
			insert_song_unlocks_without_charge: {
				data: unlockedRows,
				error: null,
			},
		});

		const client = {
			from: fromFn,
			rpc: rpcFn,
		} as unknown as AdminSupabaseClient;

		const result = await grantFreeAllocation(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.unlockedIds).toHaveLength(15);

		expect(rpcFn).toHaveBeenCalledWith("insert_song_unlocks_without_charge", {
			p_account_id: "acc-1",
			p_song_ids: likedSongs.map((s) => s.song_id),
			p_source: "free_auto",
		});

		expect(mockedApplyChange).toHaveBeenCalledWith({
			kind: "songs_unlocked",
			accountId: "acc-1",
			songIds: result.value.unlockedIds,
		});
	});

	it("returns empty when no liked songs", async () => {
		const fromFn = mockFrom({
			liked_song: {
				selectResult: { data: [], error: null },
			},
		});

		const rpcFn = vi.fn();

		const client = {
			from: fromFn,
			rpc: rpcFn,
		} as unknown as AdminSupabaseClient;

		const result = await grantFreeAllocation(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.unlockedIds).toEqual([]);
		expect(rpcFn).not.toHaveBeenCalled();
		expect(mockedApplyChange).not.toHaveBeenCalled();
	});

	it("does not emit change when RPC returns no newly unlocked songs", async () => {
		const fromFn = mockFrom({
			liked_song: {
				selectResult: {
					data: [{ song_id: "s1" }],
					error: null,
				},
			},
		});

		const rpcFn = mockRpc({
			insert_song_unlocks_without_charge: {
				data: [],
				error: null,
			},
		});

		const client = {
			from: fromFn,
			rpc: rpcFn,
		} as unknown as AdminSupabaseClient;

		const result = await grantFreeAllocation(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.unlockedIds).toEqual([]);
		expect(mockedApplyChange).not.toHaveBeenCalled();
	});

	it("returns db_error when liked_song query fails", async () => {
		const fromFn = mockFrom({});

		fromFn.mockImplementation(() => {
			const limitFn = vi.fn().mockResolvedValue({
				data: null,
				error: { code: "42P01", message: "relation does not exist" },
			});
			const orderFn = vi.fn().mockReturnValue({ limit: limitFn });
			const isFn = vi.fn().mockReturnValue({ order: orderFn });
			const eqFn = vi.fn().mockReturnValue({ is: isFn });
			const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
			return { select: selectFn };
		});

		const client = { from: fromFn } as unknown as AdminSupabaseClient;

		const result = await grantFreeAllocation(client, "acc-1");

		expect(Result.isError(result)).toBe(true);
		if (!Result.isError(result)) return;

		expect(result.error.kind).toBe("db_error");
	});

	it("returns db_error when RPC fails", async () => {
		const fromFn = mockFrom({
			liked_song: {
				selectResult: {
					data: [{ song_id: "s1" }],
					error: null,
				},
			},
		});

		const rpcFn = mockRpc({
			insert_song_unlocks_without_charge: {
				data: null,
				error: { code: "P0001", message: "rpc failed" },
			},
		});

		const client = {
			from: fromFn,
			rpc: rpcFn,
		} as unknown as AdminSupabaseClient;

		const result = await grantFreeAllocation(client, "acc-1");

		expect(Result.isError(result)).toBe(true);
		if (!Result.isError(result)) return;

		expect(result.error.kind).toBe("db_error");
	});
});

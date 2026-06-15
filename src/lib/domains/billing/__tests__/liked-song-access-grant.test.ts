import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: vi.fn(),
}));

import type { AdminSupabaseClient } from "@/lib/data/client";
import { DatabaseError } from "@/lib/shared/errors/database";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";
import type { LibraryProcessingApplyOutcome } from "@/lib/workflows/library-processing/types";
import {
	grantLikedSongAccessForAccount,
	maybeGrantLikedSongAccessAfterSync,
} from "../liked-song-access-grant";

const mockedApply = vi.mocked(applyLibraryProcessingChange);

function makeApplyOutcome(): LibraryProcessingApplyOutcome {
	return {
		accountId: "a1",
		changeKind: "songs_unlocked",
		state: {
			accountId: "a1",
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
	};
}

type RpcResult = { data: unknown; error: unknown };

function makeClient(opts: {
	grantRow?: { origin: string; applied_at: string | null } | null;
	grantRowError?: { message: string } | null;
	rpc?: (name: string) => RpcResult;
}) {
	const rpcFn = vi
		.fn()
		.mockImplementation((name: string) =>
			Promise.resolve(opts.rpc ? opts.rpc(name) : { data: null, error: null }),
		);
	const maybeSingle = vi.fn().mockResolvedValue({
		data: opts.grantRow ?? null,
		error: opts.grantRowError ?? null,
	});
	const eq = vi.fn().mockReturnValue({ maybeSingle });
	const select = vi.fn().mockReturnValue({ eq });
	const from = vi.fn().mockReturnValue({ select });
	const client = { rpc: rpcFn, from } as unknown as AdminSupabaseClient;
	return { client, rpcFn };
}

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	mockedApply.mockResolvedValue(Result.ok(makeApplyOutcome()));
});

afterEach(() => {
	vi.restoreAllMocks();
	mockedApply.mockReset();
});

describe("grantLikedSongAccessForAccount", () => {
	it("emits a songs_unlocked change for net-new unlocks on applied", async () => {
		const { client } = makeClient({
			rpc: () => ({
				data: {
					status: "applied",
					candidate_count: 2,
					newly_unlocked_song_ids: ["s1", "s2"],
				},
				error: null,
			}),
		});

		const result = await grantLikedSongAccessForAccount(client, {
			accountId: "a1",
			origin: "operator_manual",
		});

		expect(Result.isOk(result)).toBe(true);
		expect(Result.isOk(result) && result.value).toEqual({
			status: "applied",
			candidateCount: 2,
			newlyUnlockedSongIds: ["s1", "s2"],
		});
		expect(mockedApply).toHaveBeenCalledExactlyOnceWith({
			kind: "songs_unlocked",
			accountId: "a1",
			songIds: ["s1", "s2"],
		});
	});

	it("does not emit a change when applied unlocked nothing net-new", async () => {
		const { client } = makeClient({
			rpc: () => ({
				data: {
					status: "applied",
					candidate_count: 3,
					newly_unlocked_song_ids: [],
				},
				error: null,
			}),
		});

		const result = await grantLikedSongAccessForAccount(client, {
			accountId: "a1",
			origin: "operator_manual",
		});

		expect(Result.isOk(result) && result.value.status).toBe("applied");
		expect(mockedApply).not.toHaveBeenCalled();
	});

	it("preserves the DB result even if emitting the change fails", async () => {
		mockedApply.mockResolvedValue(
			Result.err({
				kind: "load_state",
				cause: new DatabaseError({ code: "X", message: "boom" }),
			}),
		);
		const { client } = makeClient({
			rpc: () => ({
				data: {
					status: "applied",
					candidate_count: 1,
					newly_unlocked_song_ids: ["s1"],
				},
				error: null,
			}),
		});

		const result = await grantLikedSongAccessForAccount(client, {
			accountId: "a1",
			origin: "operator_manual",
		});

		expect(Result.isOk(result) && result.value.status).toBe("applied");
	});

	it("returns an error on an RPC failure", async () => {
		const { client } = makeClient({
			rpc: () => ({ data: null, error: { code: "XX", message: "rpc boom" } }),
		});

		const result = await grantLikedSongAccessForAccount(client, {
			accountId: "a1",
			origin: "operator_manual",
		});

		expect(Result.isError(result)).toBe(true);
		expect(mockedApply).not.toHaveBeenCalled();
	});

	it("returns an error on an unexpected payload shape", async () => {
		const { client } = makeClient({
			rpc: () => ({ data: { status: "bogus" }, error: null }),
		});

		const result = await grantLikedSongAccessForAccount(client, {
			accountId: "a1",
			origin: "operator_manual",
		});

		expect(Result.isError(result)).toBe(true);
	});

	it("omits optional audit args when not provided", async () => {
		const { client, rpcFn } = makeClient({
			rpc: () => ({ data: { status: "pending_no_liked_songs" }, error: null }),
		});

		await grantLikedSongAccessForAccount(client, {
			accountId: "a1",
			origin: "waitlist_auto",
		});

		expect(rpcFn).toHaveBeenCalledWith("grant_liked_song_access", {
			p_account_id: "a1",
			p_origin: "waitlist_auto",
		});
	});

	it("forwards requested_by and note when provided", async () => {
		const { client, rpcFn } = makeClient({
			rpc: () => ({ data: { status: "pending_no_liked_songs" }, error: null }),
		});

		await grantLikedSongAccessForAccount(client, {
			accountId: "a1",
			origin: "operator_manual",
			requestedBy: "ops",
			note: "vip",
		});

		expect(rpcFn).toHaveBeenCalledWith("grant_liked_song_access", {
			p_account_id: "a1",
			p_origin: "operator_manual",
			p_requested_by: "ops",
			p_note: "vip",
		});
	});

	it("forwards p_limit when a custom limit is provided", async () => {
		const { client, rpcFn } = makeClient({
			rpc: () => ({ data: { status: "pending_no_liked_songs" }, error: null }),
		});

		await grantLikedSongAccessForAccount(client, {
			accountId: "a1",
			origin: "operator_manual",
			limit: 250,
		});

		expect(rpcFn).toHaveBeenCalledWith("grant_liked_song_access", {
			p_account_id: "a1",
			p_origin: "operator_manual",
			p_limit: 250,
		});
	});
});

describe("maybeGrantLikedSongAccessAfterSync", () => {
	it("applies a pending grant before any waitlist lookup", async () => {
		const { client, rpcFn } = makeClient({
			grantRow: { origin: "operator_manual", applied_at: null },
			rpc: () => ({
				data: {
					status: "applied",
					candidate_count: 1,
					newly_unlocked_song_ids: ["s1"],
				},
				error: null,
			}),
		});

		await maybeGrantLikedSongAccessAfterSync(client, "a1");

		expect(rpcFn).toHaveBeenCalledExactlyOnceWith("grant_liked_song_access", {
			p_account_id: "a1",
			p_origin: "operator_manual",
		});
		expect(rpcFn).not.toHaveBeenCalledWith(
			"is_waitlist_eligible_for_liked_song_grant",
			expect.anything(),
		);
	});

	it("does nothing when an applied grant row already exists", async () => {
		const { client, rpcFn } = makeClient({
			grantRow: { origin: "waitlist_auto", applied_at: "2026-01-01T00:00:00Z" },
		});

		await maybeGrantLikedSongAccessAfterSync(client, "a1");

		expect(rpcFn).not.toHaveBeenCalled();
	});

	it("grants with origin waitlist_auto when eligible and no row exists", async () => {
		const { client, rpcFn } = makeClient({
			grantRow: null,
			rpc: (name) =>
				name === "is_waitlist_eligible_for_liked_song_grant"
					? { data: true, error: null }
					: {
							data: {
								status: "applied",
								candidate_count: 0,
								newly_unlocked_song_ids: [],
							},
							error: null,
						},
		});

		await maybeGrantLikedSongAccessAfterSync(client, "a1");

		expect(rpcFn).toHaveBeenCalledWith(
			"is_waitlist_eligible_for_liked_song_grant",
			{ p_account_id: "a1" },
		);
		expect(rpcFn).toHaveBeenCalledWith("grant_liked_song_access", {
			p_account_id: "a1",
			p_origin: "waitlist_auto",
		});
	});

	it("does not grant when not waitlist-eligible", async () => {
		const { client, rpcFn } = makeClient({
			grantRow: null,
			rpc: () => ({ data: false, error: null }),
		});

		await maybeGrantLikedSongAccessAfterSync(client, "a1");

		expect(rpcFn).not.toHaveBeenCalledWith(
			"grant_liked_song_access",
			expect.anything(),
		);
	});

	it("swallows a grant-row read error without throwing", async () => {
		const { client, rpcFn } = makeClient({
			grantRowError: { message: "read fail" },
		});

		await expect(
			maybeGrantLikedSongAccessAfterSync(client, "a1"),
		).resolves.toBeUndefined();
		expect(rpcFn).not.toHaveBeenCalled();
	});

	it("swallows an eligibility RPC error without granting", async () => {
		const { client, rpcFn } = makeClient({
			grantRow: null,
			rpc: () => ({ data: null, error: { message: "elig fail" } }),
		});

		await expect(
			maybeGrantLikedSongAccessAfterSync(client, "a1"),
		).resolves.toBeUndefined();
		expect(rpcFn).not.toHaveBeenCalledWith(
			"grant_liked_song_access",
			expect.anything(),
		);
	});
});

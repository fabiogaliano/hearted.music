/**
 * Match review queue query-level tests.
 *
 * These exercise the real query functions with only the Supabase client mocked,
 * so they assert the actual filter/chain shape — e.g. that the presented-update
 * is guarded against resurrecting resolved cards.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	addQueueItemDecisionAtomically,
	dismissQueueItemAtomically,
	finishQueueItemAtomically,
	updateQueueItemPresented,
	updateQueueItemResolved,
} from "../queries";

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(),
}));

const ROW = {
	id: "item-1",
	session_id: "session-1",
	account_id: "acct-1",
	song_id: "song-1",
	source_snapshot_id: "snap-1",
	position: 0,
	state: "active",
	resolution: null,
	source_fit_score: 0.85,
	was_new_at_enqueue: false,
	presented_at: "2026-06-16T00:00:00Z",
	resolved_at: null,
	created_at: "2026-06-16T00:00:00Z",
	updated_at: "2026-06-16T00:00:00Z",
	orientation: "song",
	playlist_id: null,
	visible_pairs_captured_at: null,
};

/**
 * Wires the full update chain
 *   from().update().eq("id").eq("account_id").in("state", …).select().maybeSingle()
 * and returns the .in() spy so tests can assert the conditional state guard.
 */
function mockPresentedUpdate(row: typeof ROW | null) {
	const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
	const select = vi.fn().mockReturnValue({ maybeSingle });
	const inSpy = vi.fn().mockReturnValue({ select });
	const eqAccount = vi.fn().mockReturnValue({ in: inSpy });
	const eqId = vi.fn().mockReturnValue({ eq: eqAccount });
	const update = vi.fn().mockReturnValue({ eq: eqId });
	const from = vi.fn().mockReturnValue({ update });

	vi.mocked(createAdminSupabaseClient).mockReturnValue({
		from,
	} as unknown as ReturnType<typeof createAdminSupabaseClient>);

	return { inSpy, update };
}

describe("updateQueueItemPresented", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("guards the transition to only pending/active rows", async () => {
		const { inSpy } = mockPresentedUpdate(ROW);

		await updateQueueItemPresented("item-1", "acct-1", "2026-06-16T00:00:00Z");

		// The conditional update must restrict to unresolved states so a resolved
		// card can never be resurrected (B9-C lifecycle: active replaces presented).
		expect(inSpy).toHaveBeenCalledWith("state", ["pending", "active"]);
	});

	it("returns the mapped item when an eligible row is updated", async () => {
		mockPresentedUpdate(ROW);

		const result = await updateQueueItemPresented(
			"item-1",
			"acct-1",
			"2026-06-16T00:00:00Z",
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).not.toBeNull();
			expect(result.value?.id).toBe("item-1");
			expect(result.value?.state).toBe("active");
		}
	});

	it("returns ok(null) when no eligible row matched (resolved or raced)", async () => {
		// maybeSingle yields no row without erroring → the resolved item was left
		// untouched by the .in("state", …) guard.
		mockPresentedUpdate(null);

		const result = await updateQueueItemPresented(
			"item-resolved",
			"acct-1",
			"2026-06-16T00:00:00Z",
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toBeNull();
		}
	});
});

describe("updateQueueItemResolved", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("guards the resolution to only pending/active rows", async () => {
		// Same conditional-update shape as the active transition, so two
		// concurrent finish/dismiss flows can't clobber each other's resolution.
		const { inSpy } = mockPresentedUpdate(ROW);

		await updateQueueItemResolved(
			"item-1",
			"acct-1",
			"completed",
			"dismissed",
			"2026-06-16T00:00:00Z",
		);

		expect(inSpy).toHaveBeenCalledWith("state", ["pending", "active"]);
	});

	it("returns ok(null) when the item was already resolved (no eligible row)", async () => {
		// The conditional update matched nothing — a concurrent action won the race.
		// The lost flow must see null rather than overwriting the winner's row.
		mockPresentedUpdate(null);

		const result = await updateQueueItemResolved(
			"item-resolved",
			"acct-1",
			"skipped",
			"skipped",
			"2026-06-16T00:00:00Z",
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toBeNull();
		}
	});
});

describe("addQueueItemDecisionAtomically", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls the atomic add RPC with suggestion playlist id for song orientation", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: "added", error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await addQueueItemDecisionAtomically(
			"item-1",
			"acct-1",
			null,
			"pl-1",
		);

		expect(result).toBeOk();
		expect(rpc).toHaveBeenCalledWith("add_match_review_item_decision_atomic", {
			p_item_id: "item-1",
			p_account_id: "acct-1",
			p_suggestion_song_id: undefined,
			p_suggestion_playlist_id: "pl-1",
		});
	});

	it("passes suggestion_song_id for playlist orientation", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: "added", error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await addQueueItemDecisionAtomically(
			"item-1",
			"acct-1",
			"song-2",
			null,
		);

		expect(result).toBeOk();
		expect(rpc).toHaveBeenCalledWith("add_match_review_item_decision_atomic", {
			p_item_id: "item-1",
			p_account_id: "acct-1",
			p_suggestion_song_id: "song-2",
			p_suggestion_playlist_id: undefined,
		});
	});

	it("omits both suggestion ids when both are null", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: "added", error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await addQueueItemDecisionAtomically(
			"item-1",
			"acct-1",
			null,
			null,
		);

		expect(result).toBeOk();
		expect(rpc).toHaveBeenCalledWith(
			"add_match_review_item_decision_atomic",
			expect.objectContaining({
				p_suggestion_song_id: undefined,
				p_suggestion_playlist_id: undefined,
			}),
		);
	});

	it("returns a database error when the add RPC returns an unknown status", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: "unexpected", error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await addQueueItemDecisionAtomically(
			"item-1",
			"acct-1",
			null,
			"pl-1",
		);

		expect(result).toBeErr();
	});
});

describe("dismissQueueItemAtomically", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls the atomic dismiss RPC with server-derived decision rows", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: "dismissed", error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await dismissQueueItemAtomically("item-1", "acct-1", [
			{ playlistId: "pl-1", modelRank: 1 },
			{ playlistId: "pl-2", modelRank: null },
		]);

		expect(result).toBeOk();
		expect(rpc).toHaveBeenCalledWith("dismiss_match_review_item_atomic", {
			p_item_id: "item-1",
			p_account_id: "acct-1",
			p_decisions: [
				{ playlist_id: "pl-1", model_rank: 1 },
				{ playlist_id: "pl-2", model_rank: null },
			],
		});
	});

	it("returns a database error when the RPC returns an unknown status", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: "unexpected", error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await dismissQueueItemAtomically("item-1", "acct-1", []);

		expect(result).toBeErr();
	});
});

describe("finishQueueItemAtomically", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls the atomic finish RPC", async () => {
		const rpc = vi
			.fn()
			.mockResolvedValue({ data: "completed_added", error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await finishQueueItemAtomically("item-1", "acct-1");

		expect(result).toBeOk();
		expect(rpc).toHaveBeenCalledWith("finish_match_review_item_atomic", {
			p_item_id: "item-1",
			p_account_id: "acct-1",
		});
	});

	it("returns a database error when the finish RPC returns an unknown status", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: "unexpected", error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await finishQueueItemAtomically("item-1", "acct-1");

		expect(result).toBeErr();
	});
});

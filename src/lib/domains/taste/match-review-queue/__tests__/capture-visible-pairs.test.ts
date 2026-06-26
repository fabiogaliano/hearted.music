/**
 * Unit tests for captureVisiblePairsAtomic (MSR-23).
 *
 * These tests drive the TypeScript client layer in isolation by mocking the
 * Supabase admin client. The SQL-level invariants (dense-rank enforcement,
 * composite PK uniqueness, subject consistency) are validated in the SQL
 * function and cannot be exercised here without a live DB — see the
 * "integration-only paths" describe block at the bottom for documentation on
 * which assertions require a live connection.
 */

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { captureVisiblePairsAtomic } from "@/lib/domains/taste/match-review-queue/capture-visible-pairs";
import type { VisibleSuggestion } from "@/lib/domains/taste/match-review-queue/visible-suggestion-list";
import { DatabaseError } from "@/lib/shared/errors/database";

const ITEM_ID = "item-001";
const ACCOUNT_ID = "acct-001";

function makeSuggestion(
	override: Partial<VisibleSuggestion> = {},
): VisibleSuggestion {
	return {
		songId: "song-1",
		playlistId: "pl-1",
		fitScore: 0.8,
		modelRank: 1,
		visibleRank: 1,
		...override,
	};
}

function mockRpcResponse(data: unknown, error: unknown = null) {
	vi.mocked(createAdminSupabaseClient).mockReturnValue({
		rpc: vi.fn().mockResolvedValue({ data, error }),
	} as unknown as ReturnType<typeof createAdminSupabaseClient>);
}

describe("captureVisiblePairsAtomic — captured path", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns { status: 'captured' } when the RPC returns captured", async () => {
		mockRpcResponse({ status: "captured" });

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, [
			makeSuggestion(),
		]);

		expect(result).toEqual({ status: "captured" });
	});

	it("passes pairs with snake_case keys matching D4 to the RPC", async () => {
		const rpc = vi
			.fn()
			.mockResolvedValue({ data: { status: "captured" }, error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const suggestion = makeSuggestion({
			songId: "s-1",
			playlistId: "p-1",
			modelRank: 3,
			visibleRank: 1,
			fitScore: 0.75,
		});

		await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, [suggestion]);

		expect(rpc).toHaveBeenCalledWith(
			"capture_match_review_item_visible_pairs_atomic",
			{
				p_item_id: ITEM_ID,
				p_account_id: ACCOUNT_ID,
				p_pairs: [
					{
						song_id: "s-1",
						playlist_id: "p-1",
						model_rank: 3,
						visible_rank: 1,
						fit_score: 0.75,
					},
				],
			},
		);
	});
});

describe("captureVisiblePairsAtomic — empty path", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns { status: 'empty' } for an empty suggestions array", async () => {
		mockRpcResponse({ status: "empty" });

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, []);

		expect(result).toEqual({ status: "empty" });
	});

	it("sends an empty p_pairs array to the RPC", async () => {
		const rpc = vi
			.fn()
			.mockResolvedValue({ data: { status: "empty" }, error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, []);

		expect(rpc).toHaveBeenCalledWith(
			"capture_match_review_item_visible_pairs_atomic",
			expect.objectContaining({ p_pairs: [] }),
		);
	});
});

describe("captureVisiblePairsAtomic — already_captured idempotent path", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns already_captured with the original pairs from the RPC", async () => {
		mockRpcResponse({
			status: "already_captured",
			pairs: [
				{
					song_id: "song-1",
					playlist_id: "pl-1",
					model_rank: 1,
					visible_rank: 1,
					fit_score: 0.9,
				},
				{
					song_id: "song-1",
					playlist_id: "pl-2",
					model_rank: 2,
					visible_rank: 2,
					fit_score: 0.7,
				},
			],
		});

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, [
			makeSuggestion(),
		]);

		expect(result.status).toBe("already_captured");
		if (result.status === "already_captured") {
			expect(result.pairs).toHaveLength(2);
			expect(result.pairs[0]).toEqual({
				songId: "song-1",
				playlistId: "pl-1",
				modelRank: 1,
				visibleRank: 1,
				fitScore: 0.9,
			});
			expect(result.pairs[1]).toEqual({
				songId: "song-1",
				playlistId: "pl-2",
				modelRank: 2,
				visibleRank: 2,
				fitScore: 0.7,
			});
		}
	});

	it("returns already_captured with an empty pairs array when the original capture had no pairs", async () => {
		mockRpcResponse({ status: "already_captured", pairs: [] });

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, []);

		expect(result.status).toBe("already_captured");
		if (result.status === "already_captured") {
			expect(result.pairs).toHaveLength(0);
		}
	});

	it("returns db-error when already_captured pairs have an invalid shape", async () => {
		// RPC returns pairs with missing fields — should surface as db-error
		mockRpcResponse({
			status: "already_captured",
			pairs: [{ song_id: "song-1" }], // missing playlist_id etc.
		});

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, []);

		expect(result.status).toBe("db-error");
	});

	it("returns db-error when already_captured pairs field is not an array", async () => {
		mockRpcResponse({ status: "already_captured", pairs: "not-an-array" });

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, []);

		expect(result.status).toBe("db-error");
	});
});

describe("captureVisiblePairsAtomic — rejection statuses", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns not_found when the RPC returns not_found", async () => {
		mockRpcResponse({ status: "not_found" });

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, []);

		expect(result).toEqual({ status: "not_found" });
	});

	it("returns already_resolved when the RPC returns already_resolved", async () => {
		mockRpcResponse({ status: "already_resolved" });

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, []);

		expect(result).toEqual({ status: "already_resolved" });
	});

	it("returns invalid_input with the reason from the RPC", async () => {
		mockRpcResponse({
			status: "invalid_input",
			reason: "visible_rank must be dense 1..N with no duplicates",
		});

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, [
			makeSuggestion(),
		]);

		expect(result.status).toBe("invalid_input");
		if (result.status === "invalid_input") {
			expect(result.reason).toBe(
				"visible_rank must be dense 1..N with no duplicates",
			);
		}
	});

	it("returns invalid_input with reason 'unknown' when the RPC omits the reason field", async () => {
		mockRpcResponse({ status: "invalid_input" });

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, []);

		expect(result.status).toBe("invalid_input");
		if (result.status === "invalid_input") {
			expect(result.reason).toBe("unknown");
		}
	});
});

describe("captureVisiblePairsAtomic — db-error handling", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns db-error when the Supabase RPC call returns an error", async () => {
		mockRpcResponse(null, { code: "PGRST301", message: "connection timeout" });

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, []);

		expect(result.status).toBe("db-error");
		if (result.status === "db-error") {
			expect(result.error).toBeInstanceOf(DatabaseError);
		}
	});

	it("returns db-error when the RPC data is null", async () => {
		mockRpcResponse(null, null);

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, []);

		expect(result.status).toBe("db-error");
	});

	it("returns db-error when the RPC data is a non-object", async () => {
		mockRpcResponse("unexpected-string", null);

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, []);

		expect(result.status).toBe("db-error");
	});

	it("returns db-error when the RPC status is an unrecognised string", async () => {
		mockRpcResponse({ status: "totally_unknown_status" }, null);

		const result = await captureVisiblePairsAtomic(ITEM_ID, ACCOUNT_ID, []);

		expect(result.status).toBe("db-error");
	});
});

/**
 * Integration-only paths — require a live Supabase DB and cannot be exercised
 * in the unit test suite.
 *
 * The following acceptance criteria from MSR-23 need a running local Supabase
 * instance to verify:
 *
 * 1. Malformed input returns `invalid_input` with no insert:
 *    - Send a p_pairs array with missing or wrong-type fields.
 *    - Send p_pairs with non-dense visible_rank (e.g. [2, 3]).
 *
 * 2. Duplicate/non-dense visible ranks are rejected:
 *    - Send pairs with duplicate visible_rank values.
 *    - Send pairs with a gap (e.g. visible_rank 1, 3 with count=2).
 *
 * 3. Already captured items ignore new input and return original rows:
 *    - Call once (captured), call again with different pairs (already_captured
 *      returns original pairs, not the new ones).
 *
 * 4. Foreign/mismatched items are rejected:
 *    - Send pairs where song_id differs from the queue item's song_id.
 *    - Send an item_id belonging to a different account_id.
 *
 * 5. Resolved item returns already_resolved:
 *    - Create a resolved queue item, call capture → already_resolved.
 *
 * 6. Empty capture sets timestamp and activates item:
 *    - Call with an empty pairs array, then verify visible_pairs_captured_at
 *      and state='active' in the queue item row.
 */
describe.skip("captureVisiblePairsAtomic — integration-only paths (require live DB)", () => {
	it.todo("malformed JSON shape returns invalid_input with no rows inserted");
	it.todo("non-dense visible_rank returns invalid_input");
	it.todo("duplicate visible_rank returns invalid_input");
	it.todo("already captured returns original rows ignoring new input");
	it.todo("subject song_id mismatch returns invalid_input");
	it.todo("resolved item returns already_resolved");
	it.todo("empty capture sets visible_pairs_captured_at and activates item");
});

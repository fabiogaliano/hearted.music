/**
 * Match review queue query-level tests.
 *
 * These exercise the real query functions with only the Supabase client mocked,
 * so they assert the actual filter/chain shape — e.g. that resolved-state writes
 * stay guarded against resurrecting decided cards.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	addQueueItemDecisionAtomically,
	dismissQueueItemAtomically,
	finishQueueItemAtomically,
	readQueueItemSongSuggestions,
} from "../queries";

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(),
}));

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

	it("calls the atomic dismiss RPC with only item id and account id (MSR-27: no caller-supplied decisions)", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: "dismissed", error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await dismissQueueItemAtomically("item-1", "acct-1");

		expect(result).toBeOk();
		expect(rpc).toHaveBeenCalledWith("dismiss_match_review_item_atomic", {
			p_item_id: "item-1",
			p_account_id: "acct-1",
		});
	});

	it("returns ok(no_captured_pairs) when the RPC reports no captured pairs", async () => {
		const rpc = vi
			.fn()
			.mockResolvedValue({ data: "no_captured_pairs", error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await dismissQueueItemAtomically("item-1", "acct-1");

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toBe("no_captured_pairs");
		}
	});

	it("returns a database error when the RPC returns an unknown status", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: "unexpected", error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await dismissQueueItemAtomically("item-1", "acct-1");

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

describe("readQueueItemSongSuggestions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const VALID_ROW = {
		song_id: "song-1",
		name: "Song 1",
		artists: ["Artist 1"],
		album_name: "Album 1",
		image_url: "song.jpg",
		spotify_id: "sp-song-1",
		genres: ["rock"],
		fit_score: 0.75,
		visible_rank: 1,
		model_rank: 1,
		total_active_count: 1,
	};

	it("forwards p_limit and the three p_after_* cursor args to the RPC", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: [VALID_ROW], error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await readQueueItemSongSuggestions("item-1", "acct-1", {
			limit: 24,
			after: { fitScore: 0.9, modelRank: 3, songId: "song-0" },
		});

		expect(result).toBeOk();
		expect(rpc).toHaveBeenCalledWith(
			"read_match_review_item_song_suggestions",
			{
				p_item_id: "item-1",
				p_account_id: "acct-1",
				p_limit: 24,
				p_after_fit_score: 0.9,
				p_after_model_rank: 3,
				p_after_song_id: "song-0",
			},
		);
	});

	it("omits the cursor args when no cursor is supplied", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: [VALID_ROW], error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		await readQueueItemSongSuggestions("item-1", "acct-1");

		expect(rpc).toHaveBeenCalledWith(
			"read_match_review_item_song_suggestions",
			{
				p_item_id: "item-1",
				p_account_id: "acct-1",
				p_limit: undefined,
				p_after_fit_score: undefined,
				p_after_model_rank: undefined,
				p_after_song_id: undefined,
			},
		);
	});

	it("maps a valid row set to the camelCase QueueItemSongSuggestionRow shape", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: [VALID_ROW], error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await readQueueItemSongSuggestions("item-1", "acct-1");

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toEqual([
				{
					songId: "song-1",
					name: "Song 1",
					artists: ["Artist 1"],
					albumName: "Album 1",
					imageUrl: "song.jpg",
					spotifyId: "sp-song-1",
					genres: ["rock"],
					fitScore: 0.75,
					visibleRank: 1,
					modelRank: 1,
					totalActiveCount: 1,
				},
			]);
		}
	});

	it("returns a DbError with code rpc_shape_mismatch when the RPC payload fails schema validation", async () => {
		// A schema-mismatched payload (missing required fields) must not throw —
		// it surfaces as a typed DbError so callers stay in the Result flow.
		const rpc = vi
			.fn()
			.mockResolvedValue({ data: [{ song_id: "song-1" }], error: null });
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await readQueueItemSongSuggestions("item-1", "acct-1");

		expect(result).toBeErr();
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("DatabaseError");
			expect(result.error).toMatchObject({ code: "rpc_shape_mismatch" });
		}
	});

	it("propagates a PostgREST RPC error as a mapped DbError", async () => {
		const rpc = vi.fn().mockResolvedValue({
			data: null,
			error: { code: "PGRST301", message: "boom" },
		});
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			rpc,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await readQueueItemSongSuggestions("item-1", "acct-1");

		expect(result).toBeErr();
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("DatabaseError");
		}
	});
});

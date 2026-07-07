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
import { DB_IN_FILTER_CHUNK_SIZE } from "@/lib/shared/utils/chunked-write";
import {
	addQueueItemDecisionAtomically,
	dismissQueueItemAtomically,
	fetchOwnedPlaylistIds,
	finishQueueItemAtomically,
	readQueueItemSongSuggestions,
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
function mockResolvedUpdate(row: typeof ROW | null) {
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

describe("updateQueueItemResolved", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("guards the resolution to only pending/active rows", async () => {
		// Same conditional-update shape as the active transition, so two
		// concurrent finish/dismiss flows can't clobber each other's resolution.
		const { inSpy } = mockResolvedUpdate(ROW);

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
		mockResolvedUpdate(null);

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

	it.todo(
		"song orientation: writes dismissed decisions for all captured visible pairs not already added (integration)",
	);
	it.todo(
		"playlist orientation: writes dismissed decisions for all captured visible pairs not already added (integration)",
	);
	it.todo(
		"excludes pairs that already have an added decision for the same queue_item_id (integration)",
	);
	it.todo(
		"resolves queue item state=resolved resolution=dismissed (integration)",
	);
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

interface InCall {
	table: string;
	col: string;
	batch: string[];
}

type BatchResolver = (ctx: {
	table: string;
	col: string | null;
	batch: string[] | null;
}) => { data: unknown; error: unknown };

/**
 * Installs a capturing `from()` mock: chain methods return the chain, `.in()`
 * records the (table, col, batch) it received, and awaiting the chain resolves
 * to `resolver(ctx)`. Lets the chunking tests assert batch shape and merging.
 */
function installCapturingClient(resolver: BatchResolver): InCall[] {
	const inCalls: InCall[] = [];
	const from = vi.fn((table: string) => {
		const ctx: { table: string; col: string | null; batch: string[] | null } = {
			table,
			col: null,
			batch: null,
		};
		const chain: Record<string, unknown> = {};
		const passthrough = () => chain;
		chain.select = vi.fn(passthrough);
		chain.eq = vi.fn(passthrough);
		chain.is = vi.fn(passthrough);
		chain.order = vi.fn(passthrough);
		chain.in = vi.fn((col: string, batch: string[]) => {
			ctx.col = col;
			ctx.batch = batch;
			inCalls.push({ table, col, batch });
			return chain;
		});
		// biome-ignore lint/suspicious/noThenProperty: the capturing mock chain is intentionally thenable so awaiting the query resolves to the per-batch response.
		chain.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
			Promise.resolve()
				.then(() => resolver(ctx))
				.then(onF, onR);
		return chain;
	});
	vi.mocked(createAdminSupabaseClient).mockReturnValue({
		from,
	} as unknown as ReturnType<typeof createAdminSupabaseClient>);
	return inCalls;
}

describe("fetchOwnedPlaylistIds — chunking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns an empty Set for empty input without touching the client", async () => {
		installCapturingClient(() => ({ data: [], error: null }));

		const result = await fetchOwnedPlaylistIds("acct-1", []);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.size).toBe(0);
		expect(createAdminSupabaseClient).not.toHaveBeenCalled();
	});

	it("chunks the .in() ids and merges the survivors into one Set", async () => {
		const ids = Array.from({ length: 201 }, (_, i) => `pl-${i}`);
		// Echo back every id in the batch as owned.
		const inCalls = installCapturingClient((ctx) => ({
			data: (ctx.batch ?? []).map((id) => ({ id })),
			error: null,
		}));

		const result = await fetchOwnedPlaylistIds("acct-1", ids);

		expect(result).toBeOk();
		// 201 ids at chunk size 100 → 3 batches.
		expect(inCalls).toHaveLength(3);
		expect(inCalls.every((c) => c.table === "playlist")).toBe(true);
		expect(inCalls.every((c) => c.col === "id")).toBe(true);
		expect(
			inCalls.every((c) => c.batch.length <= DB_IN_FILTER_CHUNK_SIZE),
		).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value.size).toBe(201);
			expect(result.value.has("pl-200")).toBe(true);
		}
	});

	it("propagates a batch DB error as Result.err", async () => {
		const ids = Array.from({ length: 201 }, (_, i) => `pl-${i}`);
		installCapturingClient((ctx) => {
			if ((ctx.batch ?? []).includes("pl-150")) {
				return { data: null, error: { code: "PGRST301", message: "boom" } };
			}
			return { data: (ctx.batch ?? []).map((id) => ({ id })), error: null };
		});

		const result = await fetchOwnedPlaylistIds("acct-1", ids);

		expect(result).toBeErr();
		if (Result.isError(result)) expect(result.error._tag).toBe("DatabaseError");
	});
});

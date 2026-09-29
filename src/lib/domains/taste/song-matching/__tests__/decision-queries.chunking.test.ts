/**
 * Chunking behaviour for getMatchDecisionsForSongs.
 *
 * The snapshot-derived song set can run to the 1000-row cap, so the helper must
 * split the `.in("song_id", …)` filter into URL-safe batches (DB_IN_FILTER_CHUNK_SIZE)
 * rather than encoding every id into one oversized query string (the production
 * "URI too long" failure on the queue-bootstrap path). These tests drive a
 * capturing Supabase mock so we can assert the batch shape, the merge, and the
 * decided_at ordering across the chunk boundary.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_IN_FILTER_CHUNK_SIZE } from "@/lib/shared/utils/chunked-write";
import { installInFilterCapturingClient } from "@/test/mocks";

const fromMock = vi.fn();

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({ from: fromMock })),
}));

import {
	getMatchDecisionsForSongs,
	type MatchDecision,
} from "../decision-queries";

const ACCOUNT_ID = "acct-chunk-1";

function decidedAt(i: number): string {
	return new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
}

function fakeDecision(songId: string, decided_at: string): MatchDecision {
	return {
		id: `dec-${songId}`,
		account_id: ACCOUNT_ID,
		song_id: songId,
		playlist_id: "pl-1",
		decision: "added",
		decided_at,
		created_at: decided_at,
		snapshot_id: null,
		model_rank: null,
		visible_rank: null,
		served_orientation: null,
		queue_item_id: null,
	};
}

describe("getMatchDecisionsForSongs — chunking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromMock.mockReset();
	});

	it("returns ok([]) for empty input without touching the client", async () => {
		installInFilterCapturingClient(fromMock, () => ({ data: [], error: null }));

		const result = await getMatchDecisionsForSongs(ACCOUNT_ID, []);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toEqual([]);
		expect(fromMock).not.toHaveBeenCalled();
	});

	it("splits a >100 id array into multiple .in() batches each <= 100", async () => {
		const ids = Array.from({ length: 250 }, (_, i) => `song-${i}`);
		const { inCalls } = installInFilterCapturingClient(fromMock, (ctx) => ({
			data: (ctx.batch ?? []).map((id) => {
				const i = Number(id.slice("song-".length));
				return fakeDecision(id, decidedAt(i));
			}),
			error: null,
		}));

		const result = await getMatchDecisionsForSongs(ACCOUNT_ID, ids);

		expect(result).toBeOk();
		// 250 ids at chunk size 100 → 3 batches (100, 100, 50).
		expect(inCalls).toHaveLength(3);
		expect(inCalls.every((c) => c.table === "match_decision")).toBe(true);
		expect(inCalls.every((c) => c.col === "song_id")).toBe(true);
		expect(
			inCalls.every((c) => c.batch.length <= DB_IN_FILTER_CHUNK_SIZE),
		).toBe(true);
		// Every id is covered exactly once across the batches.
		expect(inCalls.flatMap((c) => c.batch).sort()).toEqual([...ids].sort());

		if (Result.isOk(result)) expect(result.value).toHaveLength(250);
	});

	it("merges chunks and re-sorts by decided_at descending across the boundary", async () => {
		// decided_at increases with the id index, and ids arrive in ascending
		// order — so each chunk returns ascending rows. A correct merge must still
		// produce a single globally descending list, proving the post-merge sort
		// spans chunk boundaries rather than just sorting within a chunk.
		const ids = Array.from({ length: 201 }, (_, i) => `song-${i}`);
		installInFilterCapturingClient(fromMock, (ctx) => ({
			data: (ctx.batch ?? []).map((id) => {
				const i = Number(id.slice("song-".length));
				return fakeDecision(id, decidedAt(i));
			}),
			error: null,
		}));

		const result = await getMatchDecisionsForSongs(ACCOUNT_ID, ids);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toHaveLength(201);
			const times = result.value.map((d) => d.decided_at);
			const sortedDesc = [...times].sort((a, b) =>
				a < b ? 1 : a > b ? -1 : 0,
			);
			expect(times).toEqual(sortedDesc);
			// The first row is the most recent (highest index), the last the oldest.
			expect(result.value[0].song_id).toBe("song-200");
			expect(result.value[result.value.length - 1].song_id).toBe("song-0");
		}
	});

	it("deduplicates ids before chunking", async () => {
		const { inCalls } = installInFilterCapturingClient(fromMock, (ctx) => ({
			data: (ctx.batch ?? []).map((id) => fakeDecision(id, decidedAt(0))),
			error: null,
		}));

		await getMatchDecisionsForSongs(ACCOUNT_ID, ["a", "a", "b", "b", "a"]);

		expect(inCalls).toHaveLength(1);
		expect(inCalls[0].batch).toEqual(["a", "b"]);
	});
});

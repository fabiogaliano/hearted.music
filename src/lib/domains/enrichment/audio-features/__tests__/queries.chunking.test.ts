/**
 * Chunking behaviour for getBatch (song audio features).
 *
 * Snapshot refresh and playlist profiling pass the full entitled/playlist song
 * set, which can run to the PostgREST max_rows cap. getBatch must split the
 * `.in("song_id", …)` filter into URL-safe batches (DB_IN_FILTER_CHUNK_SIZE)
 * rather than encoding every id into one oversized query string (the production
 * "URI too long" failure). These tests drive a capturing Supabase mock so we can
 * assert the batch shape, the merged map, and error propagation.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_IN_FILTER_CHUNK_SIZE } from "@/lib/shared/utils/chunked-write";

const fromMock = vi.fn();
const createClientMock = vi.fn(() => ({ from: fromMock }));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => createClientMock(),
}));

import { getBatch } from "../queries";

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
 * Installs a Supabase `from()` mock whose chain methods all return the chain and
 * whose `.in()` records the (table, col, batch) it was called with. The chain is
 * a thenable: awaiting it resolves to `resolver(ctx)`, yielding a per-batch
 * response regardless of which method terminates the chain.
 */
function installClient(resolver: BatchResolver): InCall[] {
	const inCalls: InCall[] = [];
	fromMock.mockImplementation((table: string) => {
		const ctx: { table: string; col: string | null; batch: string[] | null } = {
			table,
			col: null,
			batch: null,
		};
		const chain: Record<string, unknown> = {};
		const passthrough = () => chain;
		chain.select = vi.fn(passthrough);
		chain.eq = vi.fn(passthrough);
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
	return inCalls;
}

function fakeFeature(songId: string): { song_id: string; energy: number } {
	return { song_id: songId, energy: 0.5 };
}

describe("audio-features getBatch — chunking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromMock.mockReset();
	});

	it("returns an empty map for empty input without touching the client", async () => {
		installClient(() => ({ data: [], error: null }));

		const result = await getBatch([]);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.size).toBe(0);
		expect(createClientMock).not.toHaveBeenCalled();
		expect(fromMock).not.toHaveBeenCalled();
	});

	it("splits a >100 id array into multiple .in() batches each <= 100", async () => {
		const ids = Array.from({ length: 250 }, (_, i) => `song-${i}`);
		const inCalls = installClient((ctx) => ({
			data: (ctx.batch ?? []).map(fakeFeature),
			error: null,
		}));

		const result = await getBatch(ids);

		expect(result).toBeOk();
		// 250 ids at chunk size 100 → 3 batches (100, 100, 50).
		expect(inCalls).toHaveLength(3);
		expect(inCalls.every((c) => c.table === "song_audio_feature")).toBe(true);
		expect(inCalls.every((c) => c.col === "song_id")).toBe(true);
		expect(
			inCalls.every((c) => c.batch.length <= DB_IN_FILTER_CHUNK_SIZE),
		).toBe(true);
		// Every id is covered exactly once across the batches.
		expect(inCalls.flatMap((c) => c.batch).sort()).toEqual([...ids].sort());
		// The merged map keys every requested song.
		if (Result.isOk(result)) {
			expect(result.value.size).toBe(250);
			expect(result.value.get("song-0")?.song_id).toBe("song-0");
			expect(result.value.get("song-249")?.song_id).toBe("song-249");
		}
	});

	it("issues a single request when the ids fit in one chunk", async () => {
		const ids = Array.from(
			{ length: DB_IN_FILTER_CHUNK_SIZE },
			(_, i) => `s-${i}`,
		);
		const inCalls = installClient((ctx) => ({
			data: (ctx.batch ?? []).map(fakeFeature),
			error: null,
		}));

		const result = await getBatch(ids);

		expect(result).toBeOk();
		expect(inCalls).toHaveLength(1);
		expect(inCalls[0].batch).toHaveLength(DB_IN_FILTER_CHUNK_SIZE);
	});

	it("propagates a batch DB error as a Result.err DbError", async () => {
		const ids = Array.from({ length: 201 }, (_, i) => `song-${i}`);
		// Fail only the batch that contains song-150 (the second chunk).
		installClient((ctx) => {
			if ((ctx.batch ?? []).includes("song-150")) {
				return { data: null, error: { code: "PGRST301", message: "boom" } };
			}
			return { data: [], error: null };
		});

		const result = await getBatch(ids);

		expect(result).toBeErr();
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("DatabaseError");
		}
	});
});

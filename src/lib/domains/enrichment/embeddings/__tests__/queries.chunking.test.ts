/**
 * Chunking behaviour for getSongEmbeddingsBatch.
 *
 * Snapshot refresh (executeMatchSnapshotRefresh → embeddingService.getEmbeddings)
 * and playlist profiling pass song-sized id lists, which can run to the PostgREST
 * max_rows cap. The helper must split the `.in("song_id", …)` filter into URL-safe
 * batches (DB_IN_FILTER_CHUNK_SIZE) rather than encoding every id into one
 * oversized query string (the production "URI too long" failure). The capturing
 * Supabase mock lets us assert the batch shape, that the model/kind filters still
 * apply per chunk, that the latest-per-song dedup survives the merge, and error
 * propagation.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_IN_FILTER_CHUNK_SIZE } from "@/lib/shared/utils/chunked-write";

const fromMock = vi.fn();
const createClientMock = vi.fn(() => ({ from: fromMock }));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => createClientMock(),
}));

import { getSongEmbeddingsBatch } from "../queries";

interface InCall {
	table: string;
	col: string;
	batch: string[];
}

type Ctx = {
	table: string;
	col: string | null;
	batch: string[] | null;
	eqs: Array<[string, unknown]>;
};

type BatchResolver = (ctx: Ctx) => { data: unknown; error: unknown };

function installClient(resolver: BatchResolver): {
	inCalls: InCall[];
	eqCalls: Array<[string, unknown]>;
} {
	const inCalls: InCall[] = [];
	const eqCalls: Array<[string, unknown]> = [];
	fromMock.mockImplementation((table: string) => {
		const ctx: Ctx = { table, col: null, batch: null, eqs: [] };
		const chain: Record<string, unknown> = {};
		const passthrough = () => chain;
		chain.select = vi.fn(passthrough);
		chain.order = vi.fn(passthrough);
		chain.eq = vi.fn((col: string, value: unknown) => {
			ctx.eqs.push([col, value]);
			eqCalls.push([col, value]);
			return chain;
		});
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
	return { inCalls, eqCalls };
}

function row(
	songId: string,
	createdAt: string,
	contentHash: string,
): { song_id: string; created_at: string; content_hash: string } {
	return { song_id: songId, created_at: createdAt, content_hash: contentHash };
}

describe("getSongEmbeddingsBatch — chunking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromMock.mockReset();
	});

	it("returns an empty map for empty input without touching the client", async () => {
		installClient(() => ({ data: [], error: null }));

		const result = await getSongEmbeddingsBatch([], "m", "full");

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.size).toBe(0);
		expect(createClientMock).not.toHaveBeenCalled();
		expect(fromMock).not.toHaveBeenCalled();
	});

	it("splits a >100 id array into <=100 batches and keeps model/kind filters per chunk", async () => {
		const ids = Array.from({ length: 250 }, (_, i) => `song-${i}`);
		const { inCalls, eqCalls } = installClient((ctx) => ({
			data: (ctx.batch ?? []).map((id) => row(id, "2026-01-01T00:00:00Z", "h")),
			error: null,
		}));

		const result = await getSongEmbeddingsBatch(ids, "test-model", "full");

		expect(result).toBeOk();
		// 250 ids at chunk size 100 → 3 batches (100, 100, 50).
		expect(inCalls).toHaveLength(3);
		expect(inCalls.every((c) => c.table === "song_embedding")).toBe(true);
		expect(inCalls.every((c) => c.col === "song_id")).toBe(true);
		expect(
			inCalls.every((c) => c.batch.length <= DB_IN_FILTER_CHUNK_SIZE),
		).toBe(true);
		expect(inCalls.flatMap((c) => c.batch).sort()).toEqual([...ids].sort());
		// model + kind filters applied for every chunk (3 chunks × 2 eq calls).
		expect(eqCalls).toHaveLength(6);
		expect(
			eqCalls.filter(([c, v]) => c === "model" && v === "test-model"),
		).toHaveLength(3);
		expect(
			eqCalls.filter(([c, v]) => c === "kind" && v === "full"),
		).toHaveLength(3);
		if (Result.isOk(result)) expect(result.value.size).toBe(250);
	});

	it("keeps the latest-per-song row (created_at DESC first occurrence) after merge", async () => {
		// A song re-embedded under a new model_version has two rows. The per-chunk
		// query orders created_at DESC, so the first row the helper sees is the
		// newest — the merge must keep that one. Both rows share a chunk because the
		// id appears once in the input.
		const ids = ["song-A"];
		installClient(() => ({
			data: [
				row("song-A", "2026-06-01T00:00:00Z", "newest"),
				row("song-A", "2026-01-01T00:00:00Z", "oldest"),
			],
			error: null,
		}));

		const result = await getSongEmbeddingsBatch(ids, "m", "full");

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.get("song-A")?.content_hash).toBe("newest");
		}
	});

	it("propagates a batch DB error as a Result.err DbError", async () => {
		const ids = Array.from({ length: 201 }, (_, i) => `song-${i}`);
		installClient((ctx) => {
			if ((ctx.batch ?? []).includes("song-150")) {
				return { data: null, error: { code: "PGRST301", message: "boom" } };
			}
			return { data: [], error: null };
		});

		const result = await getSongEmbeddingsBatch(ids, "m", "full");

		expect(result).toBeErr();
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("DatabaseError");
		}
	});
});

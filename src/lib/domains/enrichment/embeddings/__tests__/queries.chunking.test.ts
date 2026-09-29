/**
 * Chunking behaviour for getSongEmbeddingsBatch.
 *
 * Snapshot refresh (executeMatchSnapshotRefresh → embeddingService.getEmbeddings)
 * and playlist profiling pass song-sized id lists, which can run to the PostgREST
 * max_rows cap. The helper must split the `.in("song_id", …)` filter into URL-safe
 * batches (DB_IN_FILTER_CHUNK_SIZE) rather than encoding every id into one
 * oversized query string (the production "URI too long" failure). The capturing
 * Supabase mock lets us assert the batch shape, that the model/kind filters still
 * apply per chunk, and that the latest-per-song dedup survives the merge.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_IN_FILTER_CHUNK_SIZE } from "@/lib/shared/utils/chunked-write";
import { installInFilterCapturingClient } from "@/test/mocks";

const fromMock = vi.fn();
const createClientMock = vi.fn(() => ({ from: fromMock }));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => createClientMock(),
}));

import { getSongEmbeddingsBatch } from "../queries";

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
		installInFilterCapturingClient(fromMock, () => ({ data: [], error: null }));

		const result = await getSongEmbeddingsBatch([], "m", "full");

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.size).toBe(0);
		expect(createClientMock).not.toHaveBeenCalled();
		expect(fromMock).not.toHaveBeenCalled();
	});

	it("splits a >100 id array into <=100 batches and keeps model/kind filters per chunk", async () => {
		const ids = Array.from({ length: 250 }, (_, i) => `song-${i}`);
		const { inCalls, eqCalls } = installInFilterCapturingClient(
			fromMock,
			(ctx) => ({
				data: (ctx.batch ?? []).map((id) =>
					row(id, "2026-01-01T00:00:00Z", "h"),
				),
				error: null,
			}),
		);

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
		installInFilterCapturingClient(fromMock, () => ({
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
});

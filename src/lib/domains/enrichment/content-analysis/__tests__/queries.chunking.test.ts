/**
 * Chunking behaviour for content-analysis get() (batch overload).
 *
 * The snapshot-refresh ranking stage loads analyses for the stored-pair song set
 * (getSongAnalyses → get(string[])), which can be song-sized. The helper must
 * split the `.in("song_id", …)` filter into URL-safe batches
 * (DB_IN_FILTER_CHUNK_SIZE) rather than encoding every id into one oversized
 * query string (the production "URI too long" failure). The single-id overload
 * stays a one-shot read. The capturing Supabase mock asserts batch shape, the
 * latest-per-song merge, and the single-overload path.
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

import { get } from "../queries";

function row(
	songId: string,
	createdAt: string,
	model: string,
): { song_id: string; created_at: string; model: string } {
	return { song_id: songId, created_at: createdAt, model };
}

describe("content-analysis get() — chunking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromMock.mockReset();
	});

	it("returns an empty map for an empty batch without touching the client", async () => {
		installInFilterCapturingClient(fromMock, () => ({ data: [], error: null }));

		const result = await get([]);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.size).toBe(0);
		expect(createClientMock).not.toHaveBeenCalled();
		expect(fromMock).not.toHaveBeenCalled();
	});

	it("splits a >100 id batch into multiple .in() batches each <= 100", async () => {
		const ids = Array.from({ length: 250 }, (_, i) => `song-${i}`);
		const { inCalls } = installInFilterCapturingClient(fromMock, (ctx) => ({
			data: (ctx.batch ?? []).map((id) => row(id, "2026-01-01T00:00:00Z", "m")),
			error: null,
		}));

		const result = await get(ids);

		expect(result).toBeOk();
		// 250 ids at chunk size 100 → 3 batches (100, 100, 50).
		expect(inCalls).toHaveLength(3);
		expect(inCalls.every((c) => c.table === "song_analysis")).toBe(true);
		expect(inCalls.every((c) => c.col === "song_id")).toBe(true);
		expect(
			inCalls.every((c) => c.batch.length <= DB_IN_FILTER_CHUNK_SIZE),
		).toBe(true);
		expect(inCalls.flatMap((c) => c.batch).sort()).toEqual([...ids].sort());
		if (Result.isOk(result)) expect(result.value.size).toBe(250);
	});

	it("keeps the latest-per-song analysis (created_at DESC first occurrence) after merge", async () => {
		const ids = ["song-A"];
		installInFilterCapturingClient(fromMock, () => ({
			data: [
				row("song-A", "2026-06-01T00:00:00Z", "newest"),
				row("song-A", "2026-01-01T00:00:00Z", "oldest"),
			],
			error: null,
		}));

		const result = await get(ids);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.get("song-A")?.model).toBe("newest");
		}
	});

	it("single-id overload issues one read and returns the row (not a map)", async () => {
		const { inCalls } = installInFilterCapturingClient(fromMock, (ctx) => ({
			data: (ctx.batch ?? []).map((id) => row(id, "2026-01-01T00:00:00Z", "m")),
			error: null,
		}));

		const result = await get("song-1");

		expect(result).toBeOk();
		expect(inCalls).toHaveLength(1);
		expect(inCalls[0].batch).toEqual(["song-1"]);
		if (Result.isOk(result)) {
			const value = result.value;
			// Narrow the single-id overload's union down to the row branch without a
			// cast: not null, not the batch Map, and carrying a song_id.
			expect(value).not.toBeNull();
			expect(value).not.toBeInstanceOf(Map);
			if (value !== null && !(value instanceof Map) && "song_id" in value) {
				expect(value.song_id).toBe("song-1");
			}
		}
	});

	it("single-id overload returns null when no row exists", async () => {
		installInFilterCapturingClient(fromMock, () => ({ data: [], error: null }));

		const result = await get("missing");

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBeNull();
	});
});

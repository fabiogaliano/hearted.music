/**
 * Chunking behaviour for getBatch (song audio features).
 *
 * Snapshot refresh and playlist profiling pass the full entitled/playlist song
 * set, which can run to the PostgREST max_rows cap. getBatch must split the
 * `.in("song_id", …)` filter into URL-safe batches (DB_IN_FILTER_CHUNK_SIZE)
 * rather than encoding every id into one oversized query string (the production
 * "URI too long" failure). These tests drive a capturing Supabase mock so we can
 * assert the batch shape and the merged map.
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

import { getBatch } from "../queries";

function fakeFeature(songId: string): { song_id: string; energy: number } {
	return { song_id: songId, energy: 0.5 };
}

describe("audio-features getBatch — chunking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromMock.mockReset();
	});

	it("returns an empty map for empty input without touching the client", async () => {
		installInFilterCapturingClient(fromMock, () => ({ data: [], error: null }));

		const result = await getBatch([]);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.size).toBe(0);
		expect(createClientMock).not.toHaveBeenCalled();
		expect(fromMock).not.toHaveBeenCalled();
	});

	it("splits a >100 id array into multiple .in() batches each <= 100", async () => {
		const ids = Array.from({ length: 250 }, (_, i) => `song-${i}`);
		const { inCalls } = installInFilterCapturingClient(fromMock, (ctx) => ({
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
});

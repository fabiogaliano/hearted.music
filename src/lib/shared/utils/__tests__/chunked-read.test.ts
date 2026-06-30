import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import {
	chunkedRead,
	DB_READ_CONCURRENCY,
} from "@/lib/shared/utils/chunked-read";
import { DB_IN_FILTER_CHUNK_SIZE } from "@/lib/shared/utils/chunked-write";

function okRows<T>(rows: T[]): Promise<Result<T[], DbError>> {
	return Promise.resolve(Result.ok<T[], DbError>(rows));
}

describe("chunkedRead", () => {
	it("returns ok([]) without calling the reader for empty input", async () => {
		const readChunk = vi.fn(okRows);

		const result = await chunkedRead([], readChunk);

		expect(result).toEqual(Result.ok([]));
		expect(readChunk).not.toHaveBeenCalled();
	});

	it("calls the reader once with the original ids when they fit in one chunk", async () => {
		const ids = Array.from({ length: DB_IN_FILTER_CHUNK_SIZE }, (_v, i) => i);
		const readChunk = vi.fn((chunk: number[]) => okRows(chunk));

		const result = await chunkedRead(ids, readChunk);

		expect(readChunk).toHaveBeenCalledTimes(1);
		// A fresh (mutable) array equal to the input is passed, not the readonly input itself.
		expect(readChunk).toHaveBeenCalledWith(ids);
		expect(Result.isOk(result) && result.value).toEqual(ids);
	});

	it("splits past DB_IN_FILTER_CHUNK_SIZE and concatenates every chunk's rows in order", async () => {
		const ids = Array.from({ length: 250 }, (_v, i) => i);
		const seenChunkSizes: number[] = [];
		const readChunk = (chunk: number[]) => {
			seenChunkSizes.push(chunk.length);
			return okRows(chunk);
		};

		const result = await chunkedRead(ids, readChunk);

		// 250 at the default 100 → 100 / 100 / 50.
		expect(seenChunkSizes.sort((a, b) => b - a)).toEqual([100, 100, 50]);
		expect(Result.isOk(result) && result.value).toEqual(ids);
	});

	it("honors an explicit chunkSize override", async () => {
		const ids = Array.from({ length: 120 }, (_v, i) => i);
		const seenChunkSizes: number[] = [];
		const readChunk = (chunk: number[]) => {
			seenChunkSizes.push(chunk.length);
			return okRows(chunk);
		};

		await chunkedRead(ids, readChunk, { chunkSize: 50 });

		expect(seenChunkSizes.sort((a, b) => b - a)).toEqual([50, 50, 20]);
	});

	it("surfaces the first chunk error during aggregation", async () => {
		const ids = Array.from({ length: 250 }, (_v, i) => i);
		const failure = new DatabaseError({
			code: "boom",
			message: "chunk failed",
		});
		let calls = 0;
		const readChunk = (chunk: number[]): Promise<Result<number[], DbError>> => {
			calls += 1;
			if (chunk[0] === 100) {
				return Promise.resolve(Result.err(failure));
			}
			return okRows(chunk);
		};

		const result = await chunkedRead(ids, readChunk);

		expect(Result.isError(result) && result.error).toBe(failure);
		// No abort: every chunk still fires (reads are side-effect-free); only the
		// aggregation stops at the first error.
		expect(calls).toBe(3);
	});

	it("never runs more chunks concurrently than the default read bound", async () => {
		// Six batches with a gate that only opens once all *started* chunks have
		// registered: if the helper started more than DB_READ_CONCURRENCY at once
		// the peak would exceed the bound. The gate releases each wave so the run
		// completes deterministically without timers.
		const ids = Array.from({ length: 600 }, (_v, i) => i);
		let active = 0;
		let peak = 0;
		const readChunk = async (
			chunk: number[],
		): Promise<Result<number[], DbError>> => {
			active += 1;
			peak = Math.max(peak, active);
			// Yield so sibling chunks in the same wave register before this releases.
			await Promise.resolve();
			await Promise.resolve();
			active -= 1;
			return Result.ok<number[], DbError>(chunk);
		};

		const result = await chunkedRead(ids, readChunk);

		expect(peak).toBeLessThanOrEqual(DB_READ_CONCURRENCY);
		expect(Result.isOk(result) && result.value).toEqual(ids);
	});
});

import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import {
	chunkedWrite,
	DB_WRITE_CHUNK_SIZE,
} from "@/lib/shared/utils/chunked-write";

function okRows<T>(rows: T[]): Promise<Result<T[], DbError>> {
	return Promise.resolve(Result.ok<T[], DbError>(rows));
}

describe("chunkedWrite", () => {
	it("returns ok([]) without calling the writer for empty input", async () => {
		const writeChunk = vi.fn(okRows);

		const result = await chunkedWrite([], writeChunk);

		expect(result).toEqual(Result.ok([]));
		expect(writeChunk).not.toHaveBeenCalled();
	});

	it("calls the writer once with the original array when it fits in one chunk", async () => {
		const items = Array.from({ length: DB_WRITE_CHUNK_SIZE }, (_v, i) => i);
		const writeChunk = vi.fn((chunk: number[]) => okRows(chunk));

		const result = await chunkedWrite(items, writeChunk);

		expect(writeChunk).toHaveBeenCalledTimes(1);
		expect(writeChunk).toHaveBeenCalledWith(items);
		expect(Result.isOk(result) && result.value).toEqual(items);
	});

	it("splits past the chunk size and concatenates every chunk's rows in order", async () => {
		const items = Array.from({ length: 1200 }, (_v, i) => i);
		const seenChunkSizes: number[] = [];
		const writeChunk = (chunk: number[]) => {
			seenChunkSizes.push(chunk.length);
			return okRows(chunk);
		};

		const result = await chunkedWrite(items, writeChunk);

		// 1200 at the default 500 → 500 / 500 / 200.
		expect(seenChunkSizes.sort((a, b) => b - a)).toEqual([500, 500, 200]);
		expect(Result.isOk(result) && result.value).toEqual(items);
	});

	it("honors an explicit chunkSize override", async () => {
		const items = Array.from({ length: 250 }, (_v, i) => i);
		const seenChunkSizes: number[] = [];
		const writeChunk = (chunk: number[]) => {
			seenChunkSizes.push(chunk.length);
			return okRows(chunk);
		};

		await chunkedWrite(items, writeChunk, { chunkSize: 100 });

		expect(seenChunkSizes.sort((a, b) => b - a)).toEqual([100, 100, 50]);
	});

	it("surfaces the first chunk error during aggregation", async () => {
		const items = Array.from({ length: 1500 }, (_v, i) => i);
		const failure = new DatabaseError({
			code: "boom",
			message: "chunk failed",
		});
		let calls = 0;
		const writeChunk = (
			chunk: number[],
		): Promise<Result<number[], DbError>> => {
			calls += 1;
			if (chunk[0] === 500) {
				return Promise.resolve(Result.err(failure));
			}
			return okRows(chunk);
		};

		const result = await chunkedWrite(items, writeChunk);

		expect(Result.isError(result) && result.error).toBe(failure);
		// mapWithConcurrency has no abort: every chunk still fires (harmless for
		// idempotent upserts); only the aggregation stops at the first error.
		expect(calls).toBe(3);
	});
});

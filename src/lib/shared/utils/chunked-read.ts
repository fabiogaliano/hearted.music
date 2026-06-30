/**
 * Chunked, bounded-concurrency DB reads that merge row-returning results.
 *
 * The read-side counterpart to chunkedWrite. PostgREST encodes `.in(ids)` values
 * into the query string, so an unbounded id list overflows the URI-length limit
 * (the production "URI too long" failure on the queue-bootstrap path). Splitting
 * the ids into URL-safe chunks keeps each request's query string bounded; the
 * chunks run under bounded concurrency and the first chunk error short-circuits
 * to that DbError.
 *
 * Unlike writes, reads are side-effect-free, so re-running every chunk on a
 * partial failure is harmless — there is no abort, the aggregation simply stops
 * at the first error (mirroring chunkedWrite). Callers that key results into a
 * Map/Set dedupe the merged rows naturally; callers that need a global order
 * re-sort the merged rows after this returns.
 */
import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import { DB_IN_FILTER_CHUNK_SIZE } from "@/lib/shared/utils/chunked-write";
import { chunkArray, mapWithConcurrency } from "@/lib/shared/utils/concurrency";

/**
 * Low on purpose: the goal is bounding each request's URL, not saturating the
 * connection pool. Matches the read-side bound the duplicated call sites used.
 */
export const DB_READ_CONCURRENCY = 4;

/**
 * Runs `readChunk` over `items` in chunks (DB_IN_FILTER_CHUNK_SIZE by default)
 * with bounded concurrency, surfacing the first chunk error and concatenating
 * the rows returned by every successful chunk (input order preserved).
 *
 * Empty input returns Result.ok([]) WITHOUT calling readChunk, so a caller that
 * created its client up front never issues a request for an empty id set. A
 * single chunk skips the concurrency machinery and calls readChunk directly so
 * the common small read keeps its exact prior shape and cost.
 */
export async function chunkedRead<T, R>(
	items: readonly T[],
	readChunk: (chunk: T[]) => Promise<Result<R[], DbError>>,
	options: { chunkSize?: number; concurrency?: number } = {},
): Promise<Result<R[], DbError>> {
	if (items.length === 0) {
		return Result.ok<R[], DbError>([]);
	}

	const chunkSize = options.chunkSize ?? DB_IN_FILTER_CHUNK_SIZE;
	if (items.length <= chunkSize) {
		return readChunk([...items]);
	}

	const concurrency = options.concurrency ?? DB_READ_CONCURRENCY;
	const chunks = chunkArray(items, chunkSize);
	const results = await mapWithConcurrency(chunks, concurrency, readChunk);

	const aggregated: R[] = [];
	for (const result of results) {
		if (Result.isError(result)) {
			return result;
		}
		aggregated.push(...result.value);
	}

	return Result.ok<R[], DbError>(aggregated);
}

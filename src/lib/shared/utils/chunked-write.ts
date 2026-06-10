/**
 * Chunked, bounded-concurrency DB writes that aggregate row-returning results.
 *
 * A new user's first sync writes the whole library in one shot — songs,
 * liked_song links, artists, playlists, playlist_song. Two ceilings make a
 * single unbounded write unsafe, and both stay invisible until a large library
 * trips them:
 *
 *  1. PostgREST caps a single response at `max_rows` (1000 here — see
 *     supabase/config.toml and the paging in scripts/reembed-all-songs.ts). The
 *     cap truncates the *returned* representation, and our upserts depend on that
 *     return: rows come back so we can map spotify_id -> DB-generated id and link
 *     liked_song to them. A 5k-song upsert would silently return 1k rows and drop
 *     4k links — a broken first sync with no error surfaced.
 *  2. The whole sync runs inside one Cloudflare Worker request, where every call
 *     is a metered subrequest. Chunks bound each payload without exploding the
 *     subrequest count.
 *
 * Chunking trades single-statement atomicity for partial progress on failure.
 * That's acceptable: every sync write is an idempotent upsert (or an unlike
 * update keyed by id), so a retried sync converges to the same state.
 */
import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import { chunkArray, mapWithConcurrency } from "@/lib/shared/utils/concurrency";

/**
 * Chunk size for body-encoded writes (upsert/insert). Kept well under PostgREST's
 * max_rows (1000) so a chunk's `.select()` return is never truncated.
 */
export const DB_WRITE_CHUNK_SIZE = 500;

/**
 * Chunk size for writes filtered by `.in(ids)`, where the ids ride in the URL.
 * Matches the read-side batch size so the query string can't exceed the
 * URI-length limit.
 */
export const DB_IN_FILTER_CHUNK_SIZE = 100;

/** Low on purpose: the goal is bounding each request, not saturating the pool. */
export const DB_WRITE_CONCURRENCY = 3;

/**
 * Runs `writeChunk` over `items` in chunks with bounded concurrency,
 * surfacing the first chunk error and concatenating the rows returned by every
 * successful chunk (input order preserved). There is no abort: all chunks still
 * execute even when one fails — harmless because every caller is an idempotent
 * upsert or keyed update.
 *
 * A single chunk skips the machinery and calls `writeChunk` directly, so the
 * common small write keeps its exact prior shape and cost.
 */
export async function chunkedWrite<T, R>(
	items: T[],
	writeChunk: (chunk: T[]) => Promise<Result<R[], DbError>>,
	options: { chunkSize?: number; concurrency?: number } = {},
): Promise<Result<R[], DbError>> {
	if (items.length === 0) {
		return Result.ok<R[], DbError>([]);
	}

	const chunkSize = options.chunkSize ?? DB_WRITE_CHUNK_SIZE;
	if (items.length <= chunkSize) {
		return writeChunk(items);
	}

	const concurrency = options.concurrency ?? DB_WRITE_CONCURRENCY;
	const chunks = chunkArray(items, chunkSize);
	const results = await mapWithConcurrency(chunks, concurrency, writeChunk);

	const aggregated: R[] = [];
	for (const result of results) {
		if (Result.isError(result)) {
			return result;
		}
		aggregated.push(...result.value);
	}

	return Result.ok<R[], DbError>(aggregated);
}

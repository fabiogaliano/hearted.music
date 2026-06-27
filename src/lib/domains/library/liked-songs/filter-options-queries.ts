/**
 * Aggregation queries that power the filter-options RPC.
 *
 * All queries operate on the matching-eligible population: active liked songs
 * that have passed through select_entitled_data_enriched_liked_song_ids. This
 * keeps option counts aligned with what the matching engine actually sees.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { DB_IN_FILTER_CHUNK_SIZE } from "@/lib/shared/utils/chunked-write";
import { chunkArray, mapWithConcurrency } from "@/lib/shared/utils/concurrency";

// Cap concurrent in-flight batches so a large library doesn't open dozens of
// simultaneous PostgREST connections.
const BATCH_CONCURRENCY = 4;

/**
 * Compact per-song language data from the matching-eligible population.
 * Both primary and secondary language are returned; the caller dedupes
 * per-song so a bilingual song never inflates a single code twice.
 */
export interface EligibleSongLanguageRow {
	song_id: string;
	language: string | null;
	language_secondary: string | null;
}

/**
 * Returns language columns for a set of song IDs.
 * Selects only the three columns needed for aggregation to avoid hauling full rows.
 */
export async function getLanguageColumnsForSongs(
	songIds: string[],
): Promise<Result<EligibleSongLanguageRow[], DbError>> {
	if (songIds.length === 0) {
		return Result.ok([]);
	}

	const supabase = createAdminSupabaseClient();

	// PostgREST .in() encodes ids into the query string, so chunk by the URL-safe
	// limit and run the batches concurrently rather than one serial round-trip
	// after another.
	const batches = chunkArray(songIds, DB_IN_FILTER_CHUNK_SIZE);
	const batchResults = await mapWithConcurrency(
		batches,
		BATCH_CONCURRENCY,
		async (batch) => {
			const { data, error } = await supabase
				.from("song")
				.select("id, language, language_secondary")
				.in("id", batch);
			if (error) {
				return Result.err(
					new DatabaseError({ code: error.code, message: error.message }),
				);
			}
			return Result.ok(data ?? []);
		},
	);

	const rows: EligibleSongLanguageRow[] = [];
	for (const result of batchResults) {
		if (Result.isError(result)) return result;
		for (const row of result.value) {
			rows.push({
				song_id: row.id,
				language: row.language,
				language_secondary: row.language_secondary,
			});
		}
	}

	return Result.ok(rows);
}

export interface ReleaseYearAggregateRow {
	year: number;
	count: number;
}

export interface ReleaseYearAggregate {
	min: number | null;
	max: number | null;
	counts: ReleaseYearAggregateRow[];
}

/**
 * Returns min, max, and per-year counts for the given song IDs.
 * Songs with a null release_year are excluded from all three outputs.
 */
export async function getReleaseYearAggregates(
	songIds: string[],
): Promise<Result<ReleaseYearAggregate, DbError>> {
	if (songIds.length === 0) {
		return Result.ok({ min: null, max: null, counts: [] });
	}

	const supabase = createAdminSupabaseClient();

	const batches = chunkArray(songIds, DB_IN_FILTER_CHUNK_SIZE);
	const batchResults = await mapWithConcurrency(
		batches,
		BATCH_CONCURRENCY,
		async (batch) => {
			const { data, error } = await supabase
				.from("song")
				.select("release_year")
				.in("id", batch)
				.not("release_year", "is", null);
			if (error) {
				return Result.err(
					new DatabaseError({ code: error.code, message: error.message }),
				);
			}
			return Result.ok(data ?? []);
		},
	);

	const yearFreq = new Map<number, number>();
	for (const result of batchResults) {
		if (Result.isError(result)) return result;
		for (const row of result.value) {
			if (row.release_year == null) continue;
			yearFreq.set(row.release_year, (yearFreq.get(row.release_year) ?? 0) + 1);
		}
	}

	if (yearFreq.size === 0) {
		return Result.ok({ min: null, max: null, counts: [] });
	}

	let min = Infinity;
	let max = -Infinity;
	const counts: ReleaseYearAggregateRow[] = [];

	for (const [year, count] of yearFreq) {
		if (year < min) min = year;
		if (year > max) max = year;
		counts.push({ year, count });
	}

	counts.sort((a, b) => a.year - b.year);

	return Result.ok({ min, max, counts });
}

export interface LikedAtAggregateRow {
	year: number;
	count: number;
}

export interface LikedAtAggregate {
	oldest: string | null;
	yearCounts: LikedAtAggregateRow[];
}

/**
 * Returns oldest liked_at date (YYYY-MM-DD UTC) and per-UTC-year counts
 * for active liked songs belonging to the given set of song IDs and account.
 *
 * Active means unliked_at IS NULL. The song IDs are already filtered to the
 * matching-eligible population by the caller; this query joins back to
 * liked_song so we get account-specific liked_at, not global song data.
 */
export async function getLikedAtAggregates(
	accountId: string,
	eligibleSongIds: string[],
): Promise<Result<LikedAtAggregate, DbError>> {
	if (eligibleSongIds.length === 0) {
		return Result.ok({ oldest: null, yearCounts: [] });
	}

	const supabase = createAdminSupabaseClient();

	const batches = chunkArray(eligibleSongIds, DB_IN_FILTER_CHUNK_SIZE);
	const batchResults = await mapWithConcurrency(
		batches,
		BATCH_CONCURRENCY,
		async (batch) => {
			const { data, error } = await supabase
				.from("liked_song")
				.select("liked_at")
				.eq("account_id", accountId)
				.is("unliked_at", null)
				.in("song_id", batch);
			if (error) {
				return Result.err(
					new DatabaseError({ code: error.code, message: error.message }),
				);
			}
			return Result.ok(data ?? []);
		},
	);

	let oldestTs: string | null = null;
	const yearFreq = new Map<number, number>();
	for (const result of batchResults) {
		if (Result.isError(result)) return result;
		for (const row of result.value) {
			if (!row.liked_at) continue;

			// Track the chronologically oldest timestamp across batches.
			if (oldestTs === null || row.liked_at < oldestTs) {
				oldestTs = row.liked_at;
			}

			// UTC year is extracted from the ISO timestamp prefix.
			const utcYear = new Date(row.liked_at).getUTCFullYear();
			yearFreq.set(utcYear, (yearFreq.get(utcYear) ?? 0) + 1);
		}
	}

	const oldest = oldestTs
		? oldestTs.slice(0, 10) // ISO timestamp → YYYY-MM-DD
		: null;

	const yearCounts: LikedAtAggregateRow[] = [];
	for (const [year, count] of yearFreq) {
		yearCounts.push({ year, count });
	}
	yearCounts.sort((a, b) => a.year - b.year);

	return Result.ok({ oldest, yearCounts });
}

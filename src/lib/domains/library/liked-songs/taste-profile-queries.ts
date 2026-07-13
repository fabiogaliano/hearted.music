/**
 * Aggregation queries that feed the playlist-creation seed stage's taste
 * profile — the per-account numbers the mad-lib starting templates are built
 * from (top artists, recency windows, favourite decades).
 *
 * Each query is independently testable and returns a raw-count DOMAIN shape;
 * the seed feature composes them into a TasteProfile at the server-fn layer and
 * maps that to presentation VMs. Artist, window, and release-year aggregation is
 * pushed into RPCs (account id in, buckets out) so no DB-derived id set is ever
 * re-issued as a URL .in() filter.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import type { ReleaseYearAggregate } from "./filter-options-queries";

/** One artist credited across the account's liked songs, with its like count. */
export interface TasteTopArtist {
	name: string;
	count: number;
}

/** Count of active likes falling inside a named recency window. */
export interface TasteLikedWindow {
	/** Stable window id from the RPC (e.g. "last-30d"); the VM maps it to a label. */
	id: string;
	count: number;
	/** ISO timestamp of the window's lower bound (inclusive). */
	from: string;
	/**
	 * ISO timestamp of the window's upper bound (exclusive), or null for an
	 * open-ended rolling window ("last N days" runs up to now). The VM turns this
	 * pair into the `likedAt` filter the window commits.
	 */
	to: string | null;
}

/** Liked songs rolled up into a release-decade bucket. */
export interface TasteDecade {
	/** Round decade boundary, e.g. 2010 for the 2010s. */
	decadeStart: number;
	/** Lower/upper release-year bounds shown to the user (upper clamped to the newest liked year). */
	from: number;
	to: number;
	count: number;
}

/**
 * Composed, raw-count taste profile for one account — the domain payload the
 * seed-stage server fn returns. The feature layer maps this to presentation
 * VMs (labels, rotation); nothing here carries display strings.
 */
export interface TasteProfile {
	totalLikedCount: number;
	topGenres: { name: string; count: number }[];
	topArtists: TasteTopArtist[];
	likedWindows: TasteLikedWindow[];
	decades: TasteDecade[];
}

/**
 * Top artists by like count across an account's still-liked songs, most
 * frequent first. Backs the "Around [artist]" seed template. Mirrors
 * getAccountTopGenres — a song crediting several artists counts for each.
 */
export async function getTopArtists(
	accountId: string,
	limit = 12,
): Promise<Result<TasteTopArtist[], DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc("get_account_top_artists", {
		p_account_id: accountId,
		p_limit: limit,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(
		(data ?? []).map((row) => ({
			name: row.artist,
			count: Number(row.occurrences),
		})),
	);
}

/**
 * Counts of active likes bucketed into named recency windows, computed
 * entirely in SQL from liked_at. Backs the "Liked in the [window]" template.
 * Only non-empty windows come back; ordering is imposed by the VM.
 */
export async function getLikedWindowAggregates(
	accountId: string,
): Promise<Result<TasteLikedWindow[], DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"get_account_liked_window_counts",
		{ p_account_id: accountId },
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(
		(data ?? []).map((row) => ({
			id: row.window_id,
			count: Number(row.occurrences),
			from: row.start_at,
			to: row.end_at,
		})),
	);
}

/**
 * Min, max, and per-year release counts for the account's matching-eligible
 * liked songs. The eligibility predicate lives inside the RPC so callers never
 * materialize a DB-derived song-id set and feed it back through `.in(...)`.
 */
export async function getAccountReleaseYearAggregates(
	accountId: string,
): Promise<Result<ReleaseYearAggregate, DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"get_account_release_year_counts",
		{ p_account_id: accountId },
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	const counts = (data ?? []).map((row) => ({
		year: row.release_year,
		count: Number(row.occurrences),
	}));

	if (counts.length === 0) {
		return Result.ok({ min: null, max: null, counts: [] });
	}

	return Result.ok({
		min: counts[0]?.year ?? null,
		max: counts.at(-1)?.year ?? null,
		counts,
	});
}

/**
 * Pure fold: collapse per-year release counts into per-decade buckets
 * (`Math.floor(year / 10) * 10`), most-populous decade first. `from` is the
 * round decade start; `to` is the decade end clamped to the newest liked year
 * so the open/current decade reads as "2020–2026", not "2020–2029". Deriving
 * bounds from the input keeps this deterministic and DB-free.
 */
export function rollUpDecades(aggregate: ReleaseYearAggregate): TasteDecade[] {
	if (aggregate.counts.length === 0) return [];

	const maxYear = aggregate.counts.reduce(
		(max, { year }) => (year > max ? year : max),
		Number.NEGATIVE_INFINITY,
	);

	const byDecade = new Map<number, number>();
	for (const { year, count } of aggregate.counts) {
		const decadeStart = Math.floor(year / 10) * 10;
		byDecade.set(decadeStart, (byDecade.get(decadeStart) ?? 0) + count);
	}

	return [...byDecade.entries()]
		.map(([decadeStart, count]) => ({
			decadeStart,
			from: decadeStart,
			to: Math.min(decadeStart + 9, maxYear),
			count,
		}))
		.sort((a, b) => b.count - a.count || b.decadeStart - a.decadeStart);
}

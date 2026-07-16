/**
 * Release-year review center — server actions for the control panel.
 *
 * Release years are captured automatically during sync from Spotify pathfinder:
 * playlist tracks carry the date inline, and liked songs are hydrated with
 * targeted getTrack calls. release_year_checked_at records when a liked-song
 * getTrack lookup was attempted. Combined with whether a song is still actively
 * liked, that splits year-less songs into two meaningful buckets:
 *   - pending:    release_year is null AND checked_at is null AND actively liked
 *                 → the extension should resolve it on a future liked-song sync,
 *                   so there's usually nothing for the operator to do yet.
 *   - unresolved: release_year is null AND (checked_at is not null OR not actively liked)
 *                 → either Spotify already had no usable year, or the song sits
 *                   outside the liked-song auto-lookup path (playlist-only / no
 *                   current liker). These are the genuine manual-entry cases.
 *   - set:        release_year is not null → resolved.
 *
 * The list is a read-only query; setting a year mutates prod, so it runs through
 * the deliberate read-write transaction helper (db.tx) — never the read-only
 * `read`. The song.release_year preservation trigger only guards against null
 * overwrites, so an explicit non-null year set here always wins (lets an operator
 * correct a wrong auto-captured year).
 *
 * Self-contained local SQL, like the audio review surface — no product imports.
 */

import { read, tx } from "./db";
import { HttpError } from "./http-error";
import {
	type PageResult,
	type PageSize,
	parseQueueQuery,
	type QueueOrder,
} from "./query-params";

export interface ReleaseYearReviewRow {
	songId: string;
	songName: string;
	artistLabel: string;
	albumName: string | null;
	imageUrl: string | null;
	releaseYear: number | null;
	checkedAt: string | null;
	createdAt: string;
}

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export function mapRow(r: Record<string, unknown>): ReleaseYearReviewRow {
	return {
		songId: String(r.song_id),
		songName: String(r.song_name ?? ""),
		// artist_label is array_to_string'd in SQL, so we never have to parse the
		// raw text[] literal the type-less pooler driver would otherwise return.
		artistLabel: r.artist_label == null ? "" : String(r.artist_label),
		albumName: r.album_name == null ? null : String(r.album_name),
		imageUrl: r.image_url == null ? null : String(r.image_url),
		releaseYear: numOrNull(r.release_year),
		checkedAt: r.release_year_checked_at == null
			? null
			: String(r.release_year_checked_at),
		createdAt: String(r.created_at),
	};
}

export type ReleaseYearFilter = "pending" | "unresolved" | "set";

const REVIEW_SELECT = `
	select
		s.id as song_id, s.name as song_name,
		array_to_string(s.artists, ', ') as artist_label,
		s.album_name, s.image_url, s.release_year, s.release_year_checked_at,
		s.created_at
	from public.song s
`;

const HAS_ACTIVE_LIKER = `exists (
	select 1 from public.liked_song ls
	where ls.song_id = s.id and ls.unliked_at is null
)`;

export const FILTER_WHERE: Record<ReleaseYearFilter, string> = {
	// Already checked but Spotify had no year, OR outside the liked-song
	// auto-lookup path entirely (playlist-only / no current liker).
	unresolved: `s.release_year is null and (s.release_year_checked_at is not null or not ${HAS_ACTIVE_LIKER})`,
	// Not looked up yet, but still actively liked — the extension should resolve
	// these automatically on a future sync.
	pending: `s.release_year is null and s.release_year_checked_at is null and ${HAS_ACTIVE_LIKER}`,
	set: "s.release_year is not null",
};

// Each filter has a natural time column the operator sorts on. Oldest-first is
// the drain default for the two year-less buckets; "Recently set" reads newest
// first. The queue's order toggle flips the direction on this same column.
const FILTER_TIME_COLUMN: Record<ReleaseYearFilter, string> = {
	unresolved: "s.release_year_checked_at",
	pending: "s.created_at",
	set: "s.updated_at",
};

function escapeLike(value: string): string {
	return value.replace(/([\\%_])/g, "\\$1");
}

function orderClause(filter: ReleaseYearFilter, order: QueueOrder): string {
	const dir = order === "newest" ? "desc" : "asc";
	const column = FILTER_TIME_COLUMN[filter];
	// Only checked_at is nullable (manual-only unresolved rows never looked up);
	// keep those at the far end so a real backlog sorts first. created_at breaks
	// ties deterministically for stable paging.
	if (filter === "unresolved") {
		const nulls = order === "newest" ? "nulls first" : "nulls last";
		return `${column} ${dir} ${nulls}, s.created_at ${dir}, s.id asc`;
	}
	return `${column} ${dir}, s.id asc`;
}

export interface ReleaseYearListParams {
	filter: ReleaseYearFilter;
	q: string;
	order: QueueOrder;
	page: number;
	pageSize: PageSize;
	// Year range only applies to the "set" bucket (spot-checking captured years).
	yearFrom: number | null;
	yearTo: number | null;
}

function parseReleaseYearFilter(value: string | null): ReleaseYearFilter {
	return value === "set" || value === "pending" ? value : "unresolved";
}

function parseYear(value: string | null): number | null {
	if (value === null || !/^\d{1,4}$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isInteger(parsed) ? parsed : null;
}

export function parseReleaseYearQuery(url: URL): ReleaseYearListParams {
	const filter = parseReleaseYearFilter(url.searchParams.get("filter"));
	// Preserve the historical per-bucket default direction: drain oldest-first,
	// but show the most recently corrected years first under "set".
	const defaultOrder: QueueOrder = filter === "set" ? "newest" : "oldest";
	const base = parseQueueQuery(url, defaultOrder);
	return {
		filter,
		q: base.q,
		order: base.order,
		page: base.page,
		pageSize: base.pageSize,
		yearFrom: filter === "set" ? parseYear(url.searchParams.get("yearFrom")) : null,
		yearTo: filter === "set" ? parseYear(url.searchParams.get("yearTo")) : null,
	};
}

export async function releaseYearReviewsPage(
	url: URL,
): Promise<PageResult<ReleaseYearReviewRow>> {
	const query = parseReleaseYearQuery(url);
	const params: unknown[] = [];
	const where: string[] = [FILTER_WHERE[query.filter]];
	if (query.q) {
		params.push(`%${escapeLike(query.q)}%`);
		where.push(
			`(s.name ilike $${params.length} or array_to_string(s.artists, ', ') ilike $${params.length})`,
		);
	}
	if (query.yearFrom != null) {
		params.push(query.yearFrom);
		where.push(`s.release_year >= $${params.length}`);
	}
	if (query.yearTo != null) {
		params.push(query.yearTo);
		where.push(`s.release_year <= $${params.length}`);
	}
	const predicate = where.join(" and ");
	const countRows = await read<{ total: string }>(
		`select count(*) as total from public.song s where ${predicate}`,
		params,
	);
	const total = Number(countRows[0]?.total ?? 0);
	const offset = (query.page - 1) * query.pageSize;
	const rowParams = [...params, query.pageSize, offset];
	const rows = await read(
		`${REVIEW_SELECT} where ${predicate}
		 order by ${orderClause(query.filter, query.order)}
		 limit $${rowParams.length - 1} offset $${rowParams.length}`,
		rowParams,
	);
	return {
		rows: rows.map(mapRow),
		total,
		page: query.page,
		pageSize: query.pageSize,
	};
}

/** Counts the two year-less buckets the operator cares about distinguishing. */
export async function countReleaseYearBuckets(): Promise<{
	pending: number;
	unresolved: number;
}> {
	const rows = await read<{ pending: string; unresolved: string }>(
		`select
			count(*) filter (
				where release_year is null
					and release_year_checked_at is null
					and exists (
						select 1 from public.liked_song ls
						where ls.song_id = song.id and ls.unliked_at is null
					)
			)::text as pending,
			count(*) filter (
				where release_year is null
					and (
						release_year_checked_at is not null
						or not exists (
							select 1 from public.liked_song ls
							where ls.song_id = song.id and ls.unliked_at is null
						)
					)
			)::text as unresolved
		from public.song song`,
	);
	return {
		pending: Number(rows[0]?.pending ?? 0),
		unresolved: Number(rows[0]?.unresolved ?? 0),
	};
}

// Recorded music predates Spotify's catalog, but nothing on it is 19th-century;
// keep a sane floor and allow next year for early-released singles.
const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getUTCFullYear() + 1;

export function validateReleaseYear(input: unknown): number {
	if (input == null || String(input).trim() === "") {
		throw new HttpError(400, "Year is required.");
	}
	const year = typeof input === "number" ? input : Number(String(input).trim());
	if (!Number.isInteger(year)) {
		throw new HttpError(400, "Year must be a whole number.");
	}
	if (year < MIN_YEAR || year > MAX_YEAR) {
		throw new HttpError(400, `Year must be between ${MIN_YEAR} and ${MAX_YEAR}.`);
	}
	return year;
}

export interface SetReleaseYearResult {
	ok: true;
	songId: string;
	releaseYear: number;
	// The value that was in place before this write. A non-null previous year is
	// what makes a bounded Revert possible; the preservation trigger blocks
	// restoring a null (see revertReleaseYear).
	previousYear: number | null;
}

export async function setReleaseYear(
	songId: string,
	yearInput: unknown,
): Promise<SetReleaseYearResult> {
	const year = validateReleaseYear(yearInput);
	// Read the prior value and write inside one transaction so the recorded
	// previousYear is exactly what this write replaced.
	const previousYear = await tx<number | null>(async (run) => {
		const before = await run<{ release_year: number | null }>(
			"select release_year from public.song where id = $1 for update",
			[songId],
		);
		if (before.length === 0) {
			throw new HttpError(404, "Song not found.");
		}
		await run(
			`update public.song
			 set release_year = $2, updated_at = now()
			 where id = $1`,
			[songId, year],
		);
		const prior = before[0]?.release_year ?? null;
		return prior == null ? null : Number(prior);
	});
	return { ok: true, songId, releaseYear: year, previousYear };
}

export interface RevertReleaseYearResult {
	ok: true;
	songId: string;
	releaseYear: number;
}

/**
 * Restore the year a prior run replaced, but only while the current year still
 * equals what that run wrote — otherwise something changed the value since and a
 * blind revert would clobber it (409). Reverting to null is impossible: the
 * song_preserve_release_year trigger preserves the old value on a null write, so
 * callers must reject a null `previousYear` before invoking this.
 */
export async function revertReleaseYear(
	songId: string,
	writtenYear: number,
	previousYear: number,
): Promise<RevertReleaseYearResult> {
	const restored = await tx(async (run) => {
		const current = await run<{ release_year: number | null }>(
			"select release_year from public.song where id = $1 for update",
			[songId],
		);
		if (current.length === 0) {
			throw new HttpError(404, "Song not found.");
		}
		const now = current[0]?.release_year ?? null;
		if (now == null || Number(now) !== writtenYear) {
			throw new HttpError(
				409,
				"The release year changed since this action; cannot revert.",
			);
		}
		return run<{ id: string }>(
			`update public.song
			 set release_year = $2, updated_at = now()
			 where id = $1
			 returning id`,
			[songId, previousYear],
		);
	});
	if (restored.length === 0) {
		throw new HttpError(404, "Song not found.");
	}
	return { ok: true, songId, releaseYear: previousYear };
}

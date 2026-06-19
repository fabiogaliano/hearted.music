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

const FILTER_WHERE: Record<ReleaseYearFilter, string> = {
	// Already checked but Spotify had no year, OR outside the liked-song
	// auto-lookup path entirely (playlist-only / no current liker).
	unresolved: `s.release_year is null and (s.release_year_checked_at is not null or not ${HAS_ACTIVE_LIKER})`,
	// Not looked up yet, but still actively liked — the extension should resolve
	// these automatically on a future sync.
	pending: `s.release_year is null and s.release_year_checked_at is null and ${HAS_ACTIVE_LIKER}`,
	set: "s.release_year is not null",
};

const FILTER_ORDER: Record<ReleaseYearFilter, string> = {
	// Longest-checked first; manual-only rows with no lookup attempt yet sort last.
	unresolved: "s.release_year_checked_at asc nulls last, s.created_at asc",
	pending: "s.created_at asc",
	set: "s.updated_at desc",
};

export async function listReleaseYearReviews(
	filter: ReleaseYearFilter = "unresolved",
): Promise<ReleaseYearReviewRow[]> {
	const rows = await read(
		`${REVIEW_SELECT} where ${FILTER_WHERE[filter]} order by ${FILTER_ORDER[filter]} limit 200`,
	);
	return rows.map(mapRow);
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
}

export async function setReleaseYear(
	songId: string,
	yearInput: unknown,
): Promise<SetReleaseYearResult> {
	const year = validateReleaseYear(yearInput);
	const updated = await tx(async (run) => {
		return run<{ id: string }>(
			`update public.song
			 set release_year = $2, updated_at = now()
			 where id = $1
			 returning id`,
			[songId, year],
		);
	});
	if (updated.length === 0) {
		throw new HttpError(404, "Song not found.");
	}
	return { ok: true, songId, releaseYear: year };
}

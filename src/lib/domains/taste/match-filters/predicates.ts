/**
 * Predicate helpers for hard-filter evaluation.
 *
 * Semantics:
 * - AND across filter types: every active filter must pass.
 * - OR within languages: either primary or secondary language code matches.
 * - Missing metadata fails any active filter (no "unknown" toggle).
 * - Liked-date comparisons use half-open UTC timestamp ranges from YYYY-MM-DD values.
 *
 * Predicates are pure functions — no IO, no side effects.
 */

import { utcDateString } from "./dates";
import type {
	LikedAtFilterV1,
	PlaylistMatchFiltersV1,
	ReleaseYearFilterV1,
} from "./types";

/**
 * Metadata the predicates need per song.
 * Fields are nullable because most are optional in the DB schema.
 */
export type SongFilterMetadata = {
	language: string | null;
	languageSecondary: string | null;
	releaseYear: number | null;
	vocalGender: string | null;
	/** liked_at timestamp (ms since epoch) for the current account; null if no active row. */
	likedAt: number | null;
};

/** Returns the UTC midnight start of the day after the given YYYY-MM-DD date. */
function dayAfterMidnightUtcMs(dateStr: string): number {
	const d = new Date(`${dateStr}T00:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.getTime();
}

/** Returns the UTC midnight start of the given YYYY-MM-DD date. */
function midnightUtcMs(dateStr: string): number {
	return new Date(`${dateStr}T00:00:00.000Z`).getTime();
}

export function passesLanguageFilter(
	selectedCodes: string[],
	meta: Pick<SongFilterMetadata, "language" | "languageSecondary">,
): boolean {
	if (selectedCodes.length === 0) return true;
	const { language, languageSecondary } = meta;
	if (language === null && languageSecondary === null) return false;
	return (
		(language !== null && selectedCodes.includes(language)) ||
		(languageSecondary !== null && selectedCodes.includes(languageSecondary))
	);
}

export function passesReleaseYearFilter(
	filter: ReleaseYearFilterV1,
	releaseYear: number | null,
): boolean {
	if (releaseYear === null) return false;
	switch (filter.kind) {
		case "exact":
			return releaseYear === filter.year;
		case "before":
			return releaseYear <= filter.end;
		case "after":
			return releaseYear >= filter.start;
		case "range":
			return filter.start <= releaseYear && releaseYear <= filter.end;
	}
}

/**
 * Evaluate liked-date filter using half-open UTC timestamp ranges.
 *
 * `nowMs` is the current time in ms since epoch; used to resolve `end.kind="today"`.
 * Pass `Date.now()` from the call site so this function stays pure and testable.
 */
export function passesLikedAtFilter(
	filter: LikedAtFilterV1,
	likedAtMs: number | null,
	nowMs: number,
): boolean {
	if (likedAtMs === null) return false;
	switch (filter.kind) {
		case "before":
			return likedAtMs < dayAfterMidnightUtcMs(filter.endDate);
		case "after":
			return likedAtMs >= midnightUtcMs(filter.startDate);
		case "range": {
			const startMs = midnightUtcMs(filter.startDate);
			const endExclusive =
				filter.end.kind === "today"
					? dayAfterMidnightUtcMs(utcDateString(nowMs))
					: dayAfterMidnightUtcMs(filter.end.date);
			return likedAtMs >= startMs && likedAtMs < endExclusive;
		}
	}
}

export function passesVocalGenderFilter(
	filterValue: "female" | "male",
	vocalGender: string | null,
): boolean {
	return vocalGender === filterValue;
}

/**
 * Evaluate all active hard filters for a single (song, playlist) pair.
 * Returns true when the song passes every active filter.
 *
 * `nowMs` is forwarded to the liked-date predicate for `end.kind="today"` resolution.
 */
export function passesAllMatchFilters(
	filters: PlaylistMatchFiltersV1,
	meta: SongFilterMetadata,
	nowMs: number,
): boolean {
	if (filters.languages !== undefined) {
		if (!passesLanguageFilter(filters.languages.codes, meta)) return false;
	}

	if (filters.releaseYear !== undefined) {
		if (!passesReleaseYearFilter(filters.releaseYear, meta.releaseYear))
			return false;
	}

	if (filters.likedAt !== undefined) {
		if (!passesLikedAtFilter(filters.likedAt, meta.likedAt, nowMs))
			return false;
	}

	if (filters.vocalGender !== undefined) {
		if (!passesVocalGenderFilter(filters.vocalGender, meta.vocalGender))
			return false;
	}

	return true;
}

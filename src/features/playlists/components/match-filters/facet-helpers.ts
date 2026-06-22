/**
 * Pure helpers shared by the field-list filter surface and its collapsed summary.
 *
 * Two ideas carry most of the weight:
 *   - Plain-language labels (no math operators, names not codes) so a value reads
 *     the same in a row, a summary chip, or a screen reader.
 *   - A two-field bounds projection (From/To, empty = open-ended) over the
 *     release-year and liked-date discriminated unions — the editors think in
 *     fields, the model stays in before/after/range/exact.
 */

import {
	ClockIcon,
	HeartIcon,
	MicrophoneIcon,
	type Icon as PhosphorIcon,
	TranslateIcon,
} from "@phosphor-icons/react";

import type {
	LikedAtFilterV1,
	ReleaseYearFilterV1,
} from "@/lib/domains/taste/match-filters/types";

export type FacetKey = "language" | "vocals" | "era" | "liked";

export type FacetIcon = PhosphorIcon;

// One Phosphor mark per facet, rendered at 14–16px. Shared so the row, the Add
// pill, and the collapsed summary draw the same glyph — and so the weight tracks
// the rest of the app (regular ~1px stroke) instead of the old bespoke 1.4px
// paths, which read heavier than every other icon on screen.
export const FACET_ICON: Record<FacetKey, FacetIcon> = {
	language: TranslateIcon,
	vocals: MicrophoneIcon,
	era: ClockIcon,
	liked: HeartIcon,
};

// Human label per facet, matching the field-list row wording so the collapsed
// summary names a filter the same way the editor does. The summary chips show
// only an icon + value to stay compact, so the name surfaces on hover.
export const FACET_LABEL: Record<FacetKey, string> = {
	language: "Language",
	vocals: "Vocals",
	era: "Release era",
	liked: "Liked date",
};

export function eraLabel(filter: ReleaseYearFilterV1): string {
	switch (filter.kind) {
		case "exact":
			return String(filter.year);
		case "before":
			return `Up to ${filter.end}`;
		case "after":
			return `From ${filter.start}`;
		case "range":
			return `${filter.start}–${filter.end}`;
	}
}

export function likedLabel(filter: LikedAtFilterV1): string {
	switch (filter.kind) {
		case "before":
			return `Up to ${filter.endDate}`;
		case "after":
			return `From ${filter.startDate}`;
		case "range":
			return filter.end.kind === "today"
				? `${filter.startDate} → today`
				: `${filter.startDate} – ${filter.end.date}`;
	}
}

export function vocalsLabel(value: "female" | "male"): string {
	return value === "female" ? "Female" : "Male";
}

export function languageSummary(
	codes: string[] | undefined,
	nameOf: (code: string) => string,
): string | null {
	if (!codes || codes.length === 0) return null;
	const names = codes.map(nameOf);
	if (names.length <= 2) return names.join(", ");
	return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

// --- two-field bounds <-> discriminated union (empty bound = open-ended) ---

export function yearToBounds(f: ReleaseYearFilterV1 | undefined): {
	low: string;
	high: string;
} {
	if (!f) return { low: "", high: "" };
	switch (f.kind) {
		case "exact":
			return { low: String(f.year), high: String(f.year) };
		case "before":
			return { low: "", high: String(f.end) };
		case "after":
			return { low: String(f.start), high: "" };
		case "range":
			return { low: String(f.start), high: String(f.end) };
	}
}

export function boundsToYear(
	low: string,
	high: string,
): ReleaseYearFilterV1 | undefined {
	const lo = low.trim() === "" ? null : Number(low);
	const hi = high.trim() === "" ? null : Number(high);
	if (lo === null && hi === null) return undefined;
	if (lo !== null && hi === null) return { kind: "after", start: lo };
	if (lo === null && hi !== null) return { kind: "before", end: hi };
	if (lo !== null && hi !== null) {
		if (lo === hi) return { kind: "exact", year: lo };
		return { kind: "range", start: Math.min(lo, hi), end: Math.max(lo, hi) };
	}
	return undefined;
}

// Date math on a known ISO string — deterministic, never reads the wall clock.
export function shiftDate(
	iso: string,
	opts: { days?: number; months?: number; years?: number },
): string {
	const d = new Date(`${iso}T00:00:00Z`);
	if (opts.days) d.setUTCDate(d.getUTCDate() - opts.days);
	if (opts.months) d.setUTCMonth(d.getUTCMonth() - opts.months);
	if (opts.years) d.setUTCFullYear(d.getUTCFullYear() - opts.years);
	return d.toISOString().slice(0, 10);
}

export function deriveLiked(
	from: string,
	to: string,
	today: boolean,
	oldest: string,
): LikedAtFilterV1 | undefined {
	const f = from.trim();
	const t = to.trim();
	if (today) {
		return { kind: "range", startDate: f || oldest, end: { kind: "today" } };
	}
	if (!f && !t) return undefined;
	if (f && !t) return { kind: "after", startDate: f };
	if (!f && t) return { kind: "before", endDate: t };
	return { kind: "range", startDate: f, end: { kind: "date", date: t } };
}

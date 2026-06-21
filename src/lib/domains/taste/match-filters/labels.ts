/**
 * Display/chip label helpers for match filters.
 *
 * Labels are compact value-only strings — never filter-name-prefixed.
 * They are derived from normalized filter values at render time, never stored.
 */

import { lookupLanguage } from "./languages";
import type {
	LikedAtFilterV1,
	PlaylistMatchFiltersV1,
	ReleaseYearFilterV1,
} from "./types";

export function releaseYearLabel(filter: ReleaseYearFilterV1): string {
	switch (filter.kind) {
		case "exact":
			return String(filter.year);
		case "before":
			return `≤ ${filter.end}`;
		case "after":
			return `≥ ${filter.start}`;
		case "range":
			return `${filter.start}–${filter.end}`;
	}
}

export function likedAtLabel(filter: LikedAtFilterV1): string {
	switch (filter.kind) {
		case "before":
			return `before ${filter.endDate}`;
		case "after":
			return `after ${filter.startDate}`;
		case "range": {
			const endStr = filter.end.kind === "today" ? "today" : filter.end.date;
			return `${filter.startDate} – ${endStr}`;
		}
	}
}

export function vocalGenderLabel(value: "female" | "male"): string {
	return value === "female" ? "Female" : "Male";
}

/**
 * Language label for a single code.
 * Falls back to the raw code when lookup fails (shouldn't happen for stored codes).
 */
export function languageLabel(code: string): string {
	return lookupLanguage(code)?.label ?? code;
}

/**
 * All active chip labels in fixed filter-type order:
 * languages → releaseYear → likedAt → vocalGender.
 *
 * Language chips are one per selected code, not one combined chip.
 */
export function activeFilterChipLabels(
	filters: PlaylistMatchFiltersV1,
): string[] {
	const labels: string[] = [];

	if (filters.languages) {
		for (const code of filters.languages.codes) {
			labels.push(languageLabel(code));
		}
	}

	if (filters.releaseYear) {
		labels.push(releaseYearLabel(filters.releaseYear));
	}

	if (filters.likedAt) {
		labels.push(likedAtLabel(filters.likedAt));
	}

	if (filters.vocalGender) {
		labels.push(vocalGenderLabel(filters.vocalGender));
	}

	return labels;
}

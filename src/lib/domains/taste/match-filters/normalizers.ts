/**
 * Normalization helpers for PlaylistMatchFiltersV1.
 *
 * Normalization is a pure transform — no IO, no side effects. The canonical
 * form omits inactive filters, collapses empty arrays, and deduplicates
 * language codes preserving first-selection order.
 */

import { isLanguageCatalogCode } from "./languages";
import type {
	LikedAtFilterV1,
	PlaylistMatchFiltersV1,
	ReleaseYearFilterV1,
} from "./types";

/** Deduplicate language codes preserving first-seen order. */
function dedupeLanguageCodes(codes: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const code of codes) {
		if (!seen.has(code)) {
			seen.add(code);
			out.push(code);
		}
	}
	return out;
}

function normalizeLanguages(
	raw: { codes: string[] } | undefined,
): { codes: string[] } | undefined {
	if (!raw) return undefined;
	const codes = dedupeLanguageCodes(
		raw.codes.filter((c) => isLanguageCatalogCode(c)),
	);
	return codes.length > 0 ? { codes } : undefined;
}

function normalizeReleaseYear(
	raw: ReleaseYearFilterV1 | undefined,
): ReleaseYearFilterV1 | undefined {
	return raw ?? undefined;
}

function normalizeLikedAt(
	raw: LikedAtFilterV1 | undefined,
): LikedAtFilterV1 | undefined {
	return raw ?? undefined;
}

/**
 * Produce the canonical storage form of a filters object.
 * Inactive (undefined) filters are omitted; empty language arrays normalize away.
 * The result is always valid to write.
 */
export function normalizeMatchFilters(
	raw: PlaylistMatchFiltersV1,
): PlaylistMatchFiltersV1 {
	const normalized: PlaylistMatchFiltersV1 = { version: 1 };

	const languages = normalizeLanguages(raw.languages);
	if (languages !== undefined) normalized.languages = languages;

	const releaseYear = normalizeReleaseYear(raw.releaseYear);
	if (releaseYear !== undefined) normalized.releaseYear = releaseYear;

	const likedAt = normalizeLikedAt(raw.likedAt);
	if (likedAt !== undefined) normalized.likedAt = likedAt;

	if (raw.vocalGender !== undefined) normalized.vocalGender = raw.vocalGender;

	return normalized;
}

/**
 * Returns true when no filters are active (only `version` present).
 */
export function hasActiveMatchFilters(
	filters: PlaylistMatchFiltersV1,
): boolean {
	return (
		filters.languages !== undefined ||
		filters.releaseYear !== undefined ||
		filters.likedAt !== undefined ||
		filters.vocalGender !== undefined
	);
}

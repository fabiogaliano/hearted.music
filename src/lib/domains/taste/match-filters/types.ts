/**
 * Core TypeScript types for playlist match filters.
 *
 * Discriminated unions make illegal states (e.g. a range with start > end, or
 * today-end on a non-range kind) structurally impossible rather than runtime-checked.
 */

export type ReleaseYearFilterV1 =
	| { kind: "exact"; year: number }
	| { kind: "before"; end: number }
	| { kind: "after"; start: number }
	| { kind: "range"; start: number; end: number };

export type LikedAtFilterV1 =
	| { kind: "before"; endDate: string }
	| { kind: "after"; startDate: string }
	| {
			kind: "range";
			startDate: string;
			end: { kind: "date"; date: string } | { kind: "today" };
	  };

export type PlaylistMatchFiltersV1 = {
	version: 1;
	languages?: { codes: string[] };
	releaseYear?: ReleaseYearFilterV1;
	likedAt?: LikedAtFilterV1;
	vocalGender?: "female" | "male";
};

export type MatchFilterType =
	| "languages"
	| "releaseYear"
	| "likedAt"
	| "vocalGender";

export type MatchFiltersExclusionSummary = {
	activeFilterPlaylistCount: number;
	candidatePairCount: number;
	excludedPairCount: number;
	failedChecksByType: Record<MatchFilterType, number>;
	excludedPairsByPlaylist: Record<string, number>;
	invalidStoredFiltersByPlaylist: Record<string, number>;
	degraded: {
		baseExclusions: boolean;
		filterMetadata: boolean;
	};
};

export type PlaylistMatchFilterOptions = {
	languages: Array<{
		code: string;
		label: string;
		count: number;
		source: "detected" | "catalog";
	}>;
	releaseYears: {
		min: number | null;
		max: number | null;
		counts?: Array<{ year: number; count: number }>;
	};
	likedAt: {
		oldest: string | null;
		today: string;
		yearCounts: Array<{ year: number; count: number }>;
	};
};

export type MatchFilterLanguageOption = {
	code: string;
	label: string;
};

/** Typed parse success/failure to prevent callers from accessing value on failure. */
export type ParseSuccess<T> = { ok: true; value: T };
export type ParseFailure = { ok: false; error: string };
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

/**
 * Extended success type for the forgiving read parser.
 * wasNormalized is true only when a known field had invalid data and the object
 * was reset to { version: 1 } — callers use this to emit a warning log.
 */
export type StoredParseSuccess<T> = {
	ok: true;
	value: T;
	wasNormalized: boolean;
};
export type StoredParseResult<T> = StoredParseSuccess<T> | ParseFailure;

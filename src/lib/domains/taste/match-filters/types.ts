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

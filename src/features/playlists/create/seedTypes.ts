/**
 * Presentation view-models for the playlist-creation seed stage (beat 1).
 *
 * These carry function-valued and label-bearing fields (a template's
 * `describe`, window/decade labels) — presentation shapes, not domain data — so
 * they live in the feature, not `src/lib/domains`. The raw-count domain payload
 * (`TasteProfile`) is mapped into these in `tasteProfile.ts`. The intent gate is
 * a domain return shape and lives in `@/lib/domains/playlists/intent-eligibility`.
 */

import type {
	LikedAtFilterV1,
	PlaylistMatchFiltersV1,
	ReleaseYearFilterV1,
} from "@/lib/domains/taste/match-filters/types";

/**
 * Per-account aggregates the seed templates derive from, with display labels
 * attached: `likedWindows` ← liked-song rows bucketed into named time windows,
 * `topGenres`/`topArtists` ← per-genre/-artist like counts, `decades` ←
 * release-year buckets. Templates are generated from this, never hand-authored,
 * so every account sees its own starting points with its own numbers.
 */
export interface TasteProfileVM {
	totalLikedCount: number;
	/**
	 * Named recency windows with counts, e.g. "last 30 days", "first 3 months",
	 * each carrying the resolved `likedAt` filter the window commits to — so
	 * picking one actually constrains the preview to that stretch of history.
	 */
	likedWindows: {
		id: string;
		label: string;
		count: number;
		likedAt: LikedAtFilterV1;
	}[];
	topGenres: { name: string; count: number }[];
	topArtists: { name: string; count: number }[];
	decades: { label: string; from: number; to: number; count: number }[];
}

/**
 * One fillable value for a template slot. Beyond the display `label`, a choice
 * carries the STRUCTURED config it contributes when its template is committed —
 * exactly one of these dimensions per choice, matching the template it belongs
 * to (genre → `genrePills`, decade → `releaseYear`, window → `likedAt`, artist →
 * `artist`). `resolveTemplate` folds these into the concrete `PresetVM`.
 */
export interface SeedChoiceVM {
	id: string;
	label: string;
	/** Genre pills this choice contributes (genre / blend templates). */
	genrePills?: string[];
	/** Release-year window this choice constrains to (decade template). */
	releaseYear?: ReleaseYearFilterV1;
	/** Liked-at window this choice constrains to (window template). */
	likedAt?: LikedAtFilterV1;
	/** Artist whose liked songs seed the preview as pins (artist template). */
	artist?: string;
}

/**
 * The taste dimension a template starts you from — genre (single or blend),
 * time (when a song came out OR when you liked it), or artist. Templates are
 * faceted content, and the seed stage groups them by this so a scanning user
 * reads the axes they can start from instead of one undifferentiated pile.
 */
export type SeedFacet = "genre" | "time" | "artist";

/**
 * A mad-lib starting point: literal text interleaved with cyclable slots
 * ("All things [indie]", "Throwbacks: [2010s]", "[indie] × [electronic]").
 * The card is a tiny configurator — the user tunes the slots in place, then
 * commits; resolveTemplate() collapses the choice into a concrete PresetVM.
 * Slot options come from the taste profile, so the blanks are pre-filled
 * with THIS account's genres/decades/windows, first option = default.
 */
export interface SeedTemplateVM {
	id: string;
	/** The taste dimension this template starts from, for facet grouping. */
	facet: SeedFacet;
	parts: (string | { slot: string })[];
	slots: Record<string, SeedChoiceVM[]>;
	/** Selection-aware supporting line, quoting the profile's real numbers. */
	describe: (selection: Record<string, SeedChoiceVM>) => string;
}

/** One concrete starting point the studio pre-fills its config from. */
export interface PresetVM {
	id: string;
	label: string;
	/** Short supporting line, e.g. "128 songs · updated weekly". */
	description: string;
	genrePills: string[];
	/** Hard match-filters the seed commits (decade → releaseYear, window → likedAt). */
	matchFilters?: PlaylistMatchFiltersV1;
	/**
	 * Artist whose liked songs seed the preview. The studio resolves this name to
	 * the account's liked song ids at commit time and pins them, so "Around
	 * [artist]" opens on those songs rather than the generic library top.
	 */
	pinArtist?: string;
	/**
	 * Land in the studio with the artist search focused, ready for artist #2 —
	 * set by the seed card's "+" (add-artist) affordance. The tiny card is not
	 * the place to manage a list; past one artist the studio is home.
	 */
	focusArtistSearch?: boolean;
}

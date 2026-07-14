/**
 * Presentation view-models for the playlist-creation ideas screen (beat 1).
 *
 * These carry function-valued and label-bearing fields (a idea's
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
 * Per-account aggregates the playlist ideas derive from, with display labels
 * attached: `likedWindows` ← liked-song rows bucketed into named time windows,
 * `topGenres`/`topArtists` ← per-genre/-artist like counts, `decades` ←
 * release-year buckets. Ideas are generated from this, never hand-authored,
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
 * One fillable value for a idea slot. Beyond the display `label`, a choice
 * carries the STRUCTURED config it contributes when its idea is committed —
 * exactly one of these dimensions per choice, matching the idea it belongs
 * to (genre → `genrePills`, decade → `releaseYear`, window → `likedAt`, artist →
 * `artist`). `resolveIdea` folds these into the concrete `ResolvedIdeaVM`.
 */
export interface IdeaOptionVM {
	id: string;
	label: string;
	/** Genre pills this choice contributes (genre / blend ideas). */
	genrePills?: string[];
	/** Release-year window this choice constrains to (decade idea). */
	releaseYear?: ReleaseYearFilterV1;
	/** Liked-at window this choice constrains to (window idea). */
	likedAt?: LikedAtFilterV1;
	/** Artist whose liked songs seed the preview as pins (artist idea). */
	artist?: string;
}

/**
 * The taste dimension a idea starts you from — genre (single or blend),
 * time (when a song came out OR when you liked it), or artist. Ideas are
 * faceted content, and the ideas screen groups them by this so a scanning user
 * reads the axes they can start from instead of one undifferentiated pile.
 */
export type IdeaFacet = "genre" | "time" | "artist";

/**
 * A mad-lib starting point: literal text interleaved with cyclable slots
 * ("All things [indie]", "Throwbacks: [2010s]", "[indie] × [electronic]").
 * The card is a tiny configurator — the user tunes the slots in place, then
 * commits; resolveIdea() collapses the choice into a concrete ResolvedIdeaVM.
 * Slot options come from the taste profile, so the blanks are pre-filled
 * with THIS account's genres/decades/windows, first option = default.
 */
export interface PlaylistIdeaVM {
	id: string;
	/** The taste dimension this idea starts from, for facet grouping. */
	facet: IdeaFacet;
	parts: (string | { slot: string })[];
	/**
	 * A slot's options, either fixed or a function of the current selection. The
	 * window idea's `length` options depend on the chosen `anchor` (your history's
	 * start offers different lengths than the recent end), so dead anchor×length
	 * pairs are never offered — the resolver only emits pairs the library has.
	 */
	slots: Record<
		string,
		| IdeaOptionVM[]
		| ((selection: Record<string, IdeaOptionVM>) => IdeaOptionVM[])
	>;
	/** Selection-aware supporting line, quoting the profile's real numbers. */
	describe: (selection: Record<string, IdeaOptionVM>) => string;
}

/** One concrete starting point the studio pre-fills its config from. */
export interface ResolvedIdeaVM {
	id: string;
	label: string;
	/** Short supporting line, e.g. "128 songs · updated weekly". */
	description: string;
	genrePills: string[];
	/** Hard match-filters the seed commits (decade → releaseYear, window → likedAt). */
	matchFilters?: PlaylistMatchFiltersV1;
	/**
	 * The artist this idea is anchored on. The studio resolves this name to the
	 * account's liked song ids at commit time and pins them, so "Around [artist]"
	 * opens on those songs rather than the generic library top.
	 */
	anchorArtist?: string;
	/**
	 * Land in the studio with the artist search focused, ready for artist #2 —
	 * set by the seed card's "+" (add-artist) affordance. The tiny card is not
	 * the place to manage a list; past one artist the studio is home.
	 */
	focusArtistSearch?: boolean;
}

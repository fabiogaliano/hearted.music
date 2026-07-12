/**
 * Local view-model types for the U3 Ladle-only prototypes (match-reason hints
 * + starting presets). These fake fields the real engine doesn't expose yet
 * (`matchReason`) — kept local to `prototypes/` so nothing here leaks into
 * `src/lib/domains/playlists/types.ts` or the shared fixtures.
 */

import type { SongVM } from "@/lib/domains/playlists/types";

/**
 * A SongVM-alike carrying a fictional `matchReason` string — the kind of
 * short, human explanation the engine could someday attach to a scored song
 * ("Indie pop · 2014", "Matches your Throwbacks genre pick"). Also carries
 * which genre pill (if any) it matched, for the pill-echo direction.
 */
export interface SongWithReason extends SongVM {
	/** Fictional — e.g. "Indie pop · 2014". Not on the real SongVM yet. */
	matchReason: string;
	/** Which of the active config's genre pills this song matched, if any. */
	matchedGenre?: string;
	/** Release year, used by the inline-hint direction ("Indie pop · 2014"). */
	releaseYear?: number;
}

/** One one-tap starting point shown when the config surface is empty. */
export interface PresetVM {
	id: string;
	label: string;
	/** Short supporting line, e.g. "128 songs · updated weekly". */
	description: string;
	genrePills: string[];
	intent?: string;
}

/**
 * Believable per-account aggregates that seed templates derive from — the
 * prototype stand-in for what the real feature computes server-side:
 * `likedWindows` ← liked-song rows bucketed into named time windows,
 * `topGenres` ← genre aggregation over the library, `topArtists` ←
 * per-artist like counts, `decades` ← release-year buckets. Templates are
 * generated from this, never hand-authored, so every account sees its own
 * starting points with its own numbers.
 */
export interface TasteProfileVM {
	totalLikedCount: number;
	/** Named recency windows with counts, e.g. "last 30 days", "your first 3 months". */
	likedWindows: { id: string; label: string; count: number }[];
	topGenres: { name: string; count: number }[];
	topArtists: { name: string; count: number }[];
	decades: { label: string; from: number; to: number; count: number }[];
}

/** One fillable value for a template slot. */
export interface SeedChoiceVM {
	id: string;
	label: string;
	/** Structured config this choice contributes when the template is used. */
	genrePills?: string[];
}

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
	parts: (string | { slot: string })[];
	slots: Record<string, SeedChoiceVM[]>;
	/** Selection-aware supporting line, quoting the profile's real numbers. */
	describe: (selection: Record<string, SeedChoiceVM>) => string;
}

/**
 * One way to satisfy the intent gate. Mirrors the prod predicate
 * `isIntentEligible(billingState, unlockedCount)` in
 * `src/lib/domains/playlists/intent-eligibility.ts` — currently
 * Backstage Pass OR ≥1000 unlocked songs, where unlocks are bought as
 * 500-song packs (`account_song_unlock` rows written per purchase, so
 * progress moves in pack-sized steps) — but as data, so the UI can say WHY
 * it's locked and how close the user is. The threshold is a config knob,
 * not a constant the UI knows. Promotion = widening the
 * `getIntentEligibility` server fn to return this shape instead of a boolean.
 */
export interface GateCriterionVM {
	id: string;
	/** e.g. "Backstage Pass" or "1,000 songs unlocked". */
	label: string;
	met: boolean;
	/** Present for accumulative criteria (unlock counts) — enables "340 / 1,000". */
	progress?: { current: number; target: number };
}

/** Any-of gate: `allowed` is true when at least one criterion is met. */
export interface IntentGateVM {
	allowed: boolean;
	criteria: GateCriterionVM[];
}

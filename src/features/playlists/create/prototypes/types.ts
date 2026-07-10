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

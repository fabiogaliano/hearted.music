// The read shape is owned by the Zod schema (concept-schema.ts) so the UI can't
// drift from what the prompt generates. ConceptSong is UI-only and stays here.

import type { SongDisplayState } from "@/lib/domains/billing/state";
import type {
	ConceptArcBeat,
	ConceptLineBeat,
	ConceptRead,
} from "@/lib/domains/enrichment/content-analysis/concept-schema";
import type { ThemeColor } from "@/lib/theme/types";

export type { ConceptArcBeat, ConceptLineBeat, ConceptRead };

export interface ConceptSong {
	id: string;
	spotifyTrackId: string;
	title: string;
	artist: string;
	album: string;
	// Optional: live liked-song rows carry no release year (the page RPC doesn't
	// return one), so the prod adapter omits it and the Hero hides the year.
	year?: number;
	genres: string[];
	audioFeatures: {
		tempo: number;
		energy: number;
		valence: number;
	};
	theme: ThemeColor;
	albumArtUrl?: string;
	artistImageUrl?: string;
	// Explains *why* `read` is absent so the panel can pick the right empty state
	// (locked song vs. queued/failed) instead of a single generic message. Optional
	// because the gold fixtures in concept-data.ts always carry a read, where this
	// is never consulted; the live adapter always sets it. Defaults to "analyzed".
	displayState?: SongDisplayState;
	// Null when the row has no v17 read yet (locked, not-yet-analyzed, or a pre-v17
	// 8-field row). The panel still opens — it renders the hero + a minimal empty
	// state keyed off `displayState` — so every selected song gets a panel.
	read: ConceptRead | null;
}

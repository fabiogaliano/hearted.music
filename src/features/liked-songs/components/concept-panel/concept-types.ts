// The read shape is owned by the Zod schema (concept-schema.ts) so the UI can't
// drift from what the prompt generates. ConceptSong is UI-only and stays here.

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
	read: ConceptRead;
}

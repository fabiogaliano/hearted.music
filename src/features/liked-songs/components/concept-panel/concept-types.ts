/**
 * Step 0 concept schema for the new "read" presentation model.
 *
 * Three layers, by encounter order:
 *  - Layer 1 (The Read)   — image, lens, tension
 *  - Layer 2 (The Take)   — take, optional contradiction
 *  - Layer 3 (The Trace)  — arc[3], lines[2], texture
 *
 * Everything is shown inline; no progressive disclosure inside the panel.
 *
 * This schema is intentionally separate from AnalysisContent — Step 0
 * tests whether the concept reads coherently before we touch the
 * analysis schema or the prompt.
 */

import type { ThemeColor } from "@/lib/theme/types";

export interface ConceptArcBeat {
	label: string;
	mood: string;
	scene: string;
}

export interface ConceptLineBeat {
	line: string;
	insight: string;
}

export interface ConceptRead {
	image: string;
	lens: string;
	tension: string;
	take: string;
	contradiction?: string;
	arc: [ConceptArcBeat, ConceptArcBeat, ConceptArcBeat];
	lines: [ConceptLineBeat, ConceptLineBeat];
	texture: string;
}

export interface ConceptSong {
	id: string;
	spotifyTrackId: string;
	title: string;
	artist: string;
	album: string;
	year: number;
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

// Loads a gold's heard lyrics + vote-gated annotations for the grounding judge. The judge
// is fed exactly what Phase 3 will hand the v17 prompt — the full heard text plus the
// annotations that clear GRD-6's > 15-vote floor — so "what the writer could have heard" is
// identical on both sides of the loop. The lyrics envelope is { song, lyrics: { document } };
// the document is the LyricsDocument the prod selector expects.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	renderAnnotationsBlock,
	selectGroundingAnnotations,
} from "@/lib/domains/enrichment/content-analysis/grounding-annotations";
import type { LyricsDocument } from "@/lib/domains/enrichment/lyrics/queries";

const LYRICS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"exemplars",
	"lyrics",
);

export interface GroundingContext {
	/** Full heard lyrics, section-tagged. */
	heardLyrics: string;
	/** renderAnnotationsBlock() over the > 15-vote selection; "" when none clear the gate. */
	annotationsBlock: string;
}

export function loadLyricsDoc(key: string): LyricsDocument {
	const envelope = JSON.parse(
		readFileSync(join(LYRICS_DIR, `${key}.json`), "utf-8"),
	) as { lyrics: { document: LyricsDocument } };
	return envelope.lyrics.document;
}

// Section-tagged so the judge can see structure (a place-name under [Bridge] is still a
// place-name) without us re-deriving it. Lines are the artist's exact text.
export function renderHeardLyrics(doc: LyricsDocument): string {
	return doc.sections
		.map((section) => {
			const body = section.lines.map((line) => line.text).join("\n");
			return `[${section.type}]\n${body}`;
		})
		.join("\n\n");
}

export function loadGroundingContext(key: string): GroundingContext {
	const doc = loadLyricsDoc(key);
	return {
		heardLyrics: renderHeardLyrics(doc),
		annotationsBlock: renderAnnotationsBlock(selectGroundingAnnotations(doc)),
	};
}

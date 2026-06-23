/**
 * Places Genius referent annotations onto the plain LRCLIB lyric text.
 *
 * This replaces the old anchor-tag transformer: with the Genius HTML scrape gone,
 * annotations are positioned by fuzzy-matching each referent's `fragment` against
 * the LRCLIB lines (see annotation-matcher.ts), not by rendered-page anchors.
 *
 * Output is the same TransformedLyricsBySection[] shape the formatter and storage
 * already consume — a single "lyrics" section whose lines are the LRCLIB lines,
 * with annotations attached to the first line of each matched span. Placement is
 * best-effort: a fragment that matches below the floor is dropped, never forced.
 */

import type { ResponseReferents } from "../types/genius.types";
import type {
	AnnotationInfo,
	TransformedLine,
	TransformedLyricsBySection,
} from "../types/lyrics.types";
import {
	bestFragmentMatch,
	buildLrclibStream,
	splitLyricLines,
} from "./annotation-matcher";

/**
 * Minimum fragment→line match score to attach an annotation. Tuned on a 45-song
 * eval (see claudedocs/lyrics-matching-findings.md): at 0.70 there were no real
 * misplacements, and everything dropped below it was genuinely absent from LRCLIB
 * (producer/sample tags, songs LRCLIB lacks).
 */
export const ANNOTATION_PLACEMENT_FLOOR = 0.7;

export interface AnnotationPlacementResult {
	sections: TransformedLyricsBySection[];
	/** Annotations attached (matched ≥ floor). */
	placed: number;
	/** Candidate annotations considered (worth-keeping, non-description). */
	total: number;
}

// "accepted"/"verified" are Genius editor-approved; "pending" needs a vote floor
// to keep fresh/troll community annotations out of the document. (Ported verbatim
// from the deleted transformer so the keep/drop policy is unchanged.)
function isAnnotationWorthKeeping(a: {
	state: string;
	votes_total: number;
}): boolean {
	if (a.votes_total < 0) return false;
	if (a.state === "verified" || a.state === "accepted") return true;
	return a.votes_total >= 10;
}

function toAnnotationInfo(
	a: ResponseReferents["annotations"][number],
): AnnotationInfo {
	return {
		text: a.body.plain,
		verified: a.verified,
		votes_total: a.votes_total,
		pinnedRole: a.authors?.[0]?.pinned_role,
		state: a.state,
		geniusAnnotationId: a.id,
	};
}

/**
 * Builds the annotated lyrics document from LRCLIB text + Genius referents.
 *
 * @param lrclibText Plain LRCLIB lyrics (the authoritative lyric source).
 * @param referents  Genius referents with `fragment` + annotation bodies.
 */
export function placeAnnotations(
	lrclibText: string,
	referents: ResponseReferents[],
	opts?: { floor?: number },
): AnnotationPlacementResult {
	const floor = opts?.floor ?? ANNOTATION_PLACEMENT_FLOOR;
	const lines = splitLyricLines(lrclibText);
	const stream = buildLrclibStream(lines);

	// 0-based LRCLIB line index → annotations attached there.
	const byLine = new Map<number, AnnotationInfo[]>();
	let total = 0;
	let placed = 0;

	for (const referent of referents) {
		if (referent.is_description) continue;

		const annotations = (referent.annotations ?? [])
			.filter(isAnnotationWorthKeeping)
			.map(toAnnotationInfo);
		if (annotations.length === 0) continue;

		total++;

		const match = bestFragmentMatch(referent.fragment ?? "", stream);
		if (!match || match.score < floor) continue;

		placed++;
		// Attach to the first line of the matched span (mirrors the old minId rule).
		const existing = byLine.get(match.startLine);
		if (existing) existing.push(...annotations);
		else byLine.set(match.startLine, annotations);
	}

	const transformedLines: TransformedLine[] = lines.map((text, index) => {
		const line: TransformedLine = {
			id: index + 1,
			text,
			range: { start: index + 1, end: index + 1 },
		};
		const annotations = byLine.get(index);
		if (annotations?.length) line.annotations = annotations;
		return line;
	});

	return {
		sections: [{ type: "lyrics", lines: transformedLines }],
		placed,
		total,
	};
}

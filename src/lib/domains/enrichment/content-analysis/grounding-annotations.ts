/**
 * Selects the annotations allowed to ground a read and renders them for the v17 prompt's
 * annotations slot.
 *
 * Annotations are gated at votes_total > 15 — distinct from the ingest gate
 * (`isAnnotationWorthKeeping`: editor-approved, or pending with >= 10 votes), which only keeps
 * spam out of the DB. This stricter grounding gate layers on top of whatever survived ingest.
 */

import type { LyricsDocument } from "../lyrics/queries";
import type { AnnotationInfo } from "../lyrics/types/lyrics.types";

/** Grounding floor: votes_total > 15, as an inclusive bound (>= 16). */
export const GROUNDING_MIN_VOTES = 16;

export interface SelectedAnnotation {
	/** e.g. "Intro", "Verse 1". */
	section: string;
	/** Genius line id — the stable key back to the lyric. */
	lineId: number;
	/** The lyric line the annotation explains (not the annotation text). */
	line: string;
	text: string;
	votes_total: number;
	verified: boolean;
	/** "verified" | "accepted" | "pending"; optional on older rows. */
	state?: string;
	pinnedRole?: string;
}

export interface SelectGroundingAnnotationsOptions {
	/** Inclusive vote floor; defaults to GROUNDING_MIN_VOTES. */
	minVotes?: number;
}

// In reading order, keyed to the line each note explains. `verified`/`state` ride along so a
// downstream judge can tighten the gate without re-reading the doc.
export function selectGroundingAnnotations(
	doc: LyricsDocument,
	options: SelectGroundingAnnotationsOptions = {},
): SelectedAnnotation[] {
	const minVotes = options.minVotes ?? GROUNDING_MIN_VOTES;
	const selected: SelectedAnnotation[] = [];
	for (const section of doc.sections) {
		for (const line of section.lines) {
			for (const annotation of line.annotations ?? []) {
				if (annotation.votes_total < minVotes) continue;
				selected.push(toSelected(section.type, line.id, line.text, annotation));
			}
		}
	}
	return selected;
}

function toSelected(
	section: string,
	lineId: number,
	line: string,
	annotation: AnnotationInfo,
): SelectedAnnotation {
	return {
		section,
		lineId,
		line,
		text: annotation.text,
		votes_total: annotation.votes_total,
		verified: annotation.verified,
		state: annotation.state,
		pinnedRole: annotation.pinnedRole,
	};
}

// Groups notes under their line and stamps votes so the model can weight them. Collapses each
// note to one paragraph; never truncates — Phase 3 owns any cap, and a silent cut here would
// read as "all grounding included". Empty selection → "".
export function renderAnnotationsBlock(selected: SelectedAnnotation[]): string {
	if (selected.length === 0) return "";
	const byLine = new Map<string, SelectedAnnotation[]>();
	for (const note of selected) {
		// Line ids repeat across sections (a repeated chorus reuses them), so the group key
		// is section + id. A plain separator — never an exotic one, which is how a stray NUL
		// once slipped in here.
		const key = `${note.section}::${note.lineId}`;
		const group = byLine.get(key);
		if (group) group.push(note);
		else byLine.set(key, [note]);
	}
	const blocks: string[] = [];
	for (const group of byLine.values()) {
		const head = group[0];
		const lines = [`[${head.section}] "${head.line}"`];
		for (const note of group) {
			lines.push(`  (${note.votes_total} votes) ${collapse(note.text)}`);
		}
		blocks.push(lines.join("\n"));
	}
	return blocks.join("\n\n");
}

function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

// Wraps a rendered block for the v17 generation prompt's {annotations} slot: a one-line header
// naming what the notes are and that they are trusted grounding, then the block. Empty block → ""
// so the optional slot collapses to nothing. The selection and source are identical to what the
// grounding judge sees (renderAnnotationsBlock above); only the framing differs — this addresses
// the writer, the judge's prompt addresses the auditor.
export function renderAnnotationsBlockForPrompt(block: string): string {
	if (!block.trim()) return "";
	return `Fan and editor annotations that cleared a vote gate (>15 votes). Treat what they state as grounding you can trust and build on, even where the lyrics do not spell it out:

${block}`;
}

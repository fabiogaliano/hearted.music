/**
 * One-way transformer: legacy 8-field analysis -> new-model draft. Scaffolds
 * gold exemplars only (§8.5: live exemplars/ stay bound to the old schema).
 * Mapping in claudedocs/session-3-zod-migration-notes.md §3.
 */

import type {
	ConceptArcBeat,
	ConceptLineBeat,
	Signals,
} from "./concept-schema";

// Structural subset both SongAnalysisLyrical and AnalysisContent satisfy.
export interface LegacyAnalysisInput {
	headline?: string;
	compound_mood?: string;
	mood_description?: string;
	interpretation?: string;
	themes?: Array<{ name: string; description: string; confidence?: number }>;
	journey?: Array<{ section: string; mood: string; description: string }>;
	key_lines?: Array<{ line: string; insight: string }>;
	sonic_texture?: string;
}

// lens/contradiction typed as literal null so a draft can't pass as a finished
// ConceptRead until hand-authored.
export interface ReadDraft {
	image: string;
	lens: null;
	tension: string;
	take: string;
	contradiction: null;
	arc: ConceptArcBeat[];
	lines: ConceptLineBeat[];
	texture: string;
}

export interface ConceptDraft {
	read: ReadDraft;
	signals: Signals;
}

export function transformLegacyToConceptDraft(
	legacy: LegacyAnalysisInput,
): ConceptDraft {
	const take = [legacy.interpretation, legacy.mood_description]
		.filter((part): part is string => Boolean(part))
		.join(" ");

	const arc: ConceptArcBeat[] = (legacy.journey ?? []).map((beat) => ({
		label: beat.section,
		mood: beat.mood,
		scene: beat.description,
	}));

	const lines: ConceptLineBeat[] = (legacy.key_lines ?? []).map((line) => ({
		line: line.line,
		insight: line.insight,
	}));

	return {
		read: {
			image: legacy.headline ?? "",
			lens: null,
			tension: legacy.compound_mood ?? "",
			take,
			contradiction: null,
			arc,
			lines,
			texture: legacy.sonic_texture ?? "",
		},
		signals: {
			theme_tags: [],
			themes: legacy.themes,
		},
	};
}

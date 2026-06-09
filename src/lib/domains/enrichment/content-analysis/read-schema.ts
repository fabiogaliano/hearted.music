/**
 * Zod schema for the redesigned analysis model. See
 * claudedocs/session-3-zod-migration-notes.md for the full rationale.
 *
 * Cardinality: Zod is the permissive envelope, the prompt is the narrower
 * target. Floors are looser than the prompt so coherent output is never
 * rejected (master §5.2).
 */

import { z } from "zod";

const ReadArcBeatSchema = z.object({
	label: z.string(),
	// May repeat: monochrome songs have beats but a flat register (diagnostic).
	mood: z.string(),
	scene: z.string(),
});

// A pivotal lyric quote. The per-line `insight` gloss was removed: it largely
// restated what `take` and `arc` already say, concentrated the most voice-audit
// violations, and was never read by the matching layer. The quote itself is the
// curation signal. Kept as an object (not a bare string) so historical reads that
// still carry `insight` keep validating — Zod strips the unknown key.
const ReadLineBeatSchema = z.object({
	line: z.string(),
});

export const SongReadSchema = z.object({
	image: z.string(),
	// Free string: the three-form grammar lives in the prompt + jury, not a
	// brittle Zod regex (concept-lens-vocabulary.md §3).
	lens: z.string(),
	// Qualified emotion, not a paradox; the paradox is `contradiction`'s job.
	tension: z.string(),
	take: z.string(),
	// Required key, nullable value: forces explicit null over silent omission.
	contradiction: z.string().nullable(),
	arc: z.array(ReadArcBeatSchema).min(2).max(4),
	lines: z.array(ReadLineBeatSchema).min(1).max(5),
	// Required key, nullable value: texture is the one field grounded in sound,
	// not lyrics, so it's written only when audio features exist (genre sharpens
	// it) and null otherwise. The panel hides the block on null rather than let
	// the model hallucinate a sound from the words.
	texture: z.string().nullable(),
});
export type SongRead = z.infer<typeof SongReadSchema>;
export type ReadArcBeat = z.infer<typeof ReadArcBeatSchema>;
export type ReadLineBeat = z.infer<typeof ReadLineBeatSchema>;

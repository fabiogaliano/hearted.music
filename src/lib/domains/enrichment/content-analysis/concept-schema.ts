/**
 * Zod schema for the redesigned analysis model. See
 * claudedocs/session-3-zod-migration-notes.md for the full rationale.
 *
 * Cardinality: Zod is the permissive envelope, the prompt is the narrower
 * target. Floors are looser than the prompt so coherent output is never
 * rejected (master §5.2).
 */

import { z } from "zod";

const ConceptArcBeatSchema = z.object({
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
const ConceptLineBeatSchema = z.object({
	line: z.string(),
});

export const ConceptReadSchema = z.object({
	image: z.string(),
	// Free string: the three-form grammar lives in the prompt + jury, not a
	// brittle Zod regex (concept-lens-vocabulary.md §3).
	lens: z.string(),
	// Qualified emotion, not a paradox; the paradox is `contradiction`'s job.
	tension: z.string(),
	take: z.string(),
	// Required key, nullable value: forces explicit null over silent omission.
	contradiction: z.string().nullable(),
	arc: z.array(ConceptArcBeatSchema).min(2).max(4),
	lines: z.array(ConceptLineBeatSchema).min(1).max(5),
	// Required key, nullable value: texture is the one field grounded in sound,
	// not lyrics, so it's written only when audio features exist (genre sharpens
	// it) and null otherwise. The panel hides the block on null rather than let
	// the model hallucinate a sound from the words.
	texture: z.string().nullable(),
});
export type ConceptRead = z.infer<typeof ConceptReadSchema>;
export type ConceptArcBeat = z.infer<typeof ConceptArcBeatSchema>;
export type ConceptLineBeat = z.infer<typeof ConceptLineBeatSchema>;

const LegacyThemeSchema = z.object({
	name: z.string(),
	description: z.string(),
	confidence: z.number().optional(),
});

// Matching layer. Staged: no prompt generates it yet (v14+). All fields
// optional so an early read-only row validates. theme_tags becomes a z.enum
// once the controlled vocab artifact exists.
export const SignalsSchema = z.object({
	theme_tags: z.array(z.string()).max(3).optional(),
	themes: z.array(LegacyThemeSchema).optional(),
	scenes: z
		.array(
			z.enum([
				"driving",
				"late_night",
				"gym",
				"dinner",
				"dancefloor",
				"solo_walk",
			]),
		)
		.max(3)
		.optional(),
	address: z
		.enum([
			"first_person",
			"second_person_direct",
			"narrator_distant",
			"chorus_we",
		])
		.nullable()
		.optional(),
	register: z
		.array(
			z.enum([
				"confessional",
				"swaggering",
				"ironic",
				"sincere",
				"playful",
				"liturgical",
			]),
		)
		.optional(),
	cultural_anchors: z.array(z.string()).optional(),
	eligibility: z
		.object({
			explicit: z.boolean(),
			sleep_safe: z.boolean(),
			kid_safe: z.boolean(),
			workout_ok: z.boolean(),
			dinner_ok: z.boolean(),
		})
		.partial()
		.optional(),
	// Derived downstream, not authored.
	tempo_emotion_gap: z.number().nullable().optional(),
	intensity_curve: z.enum(["builds", "stays", "falls"]).nullable().optional(),
});
export type Signals = z.infer<typeof SignalsSchema>;

export const ConceptAnalysisSchema = z.object({
	read: ConceptReadSchema,
	signals: SignalsSchema.optional(),
});
export type ConceptAnalysis = z.infer<typeof ConceptAnalysisSchema>;

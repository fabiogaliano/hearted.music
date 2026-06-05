import { z } from "zod";

export const RegisterSpecificitySchema = z
	.object({
		specific: z.boolean(),
		generic_sentences: z.array(z.string()).default([]),
		rationale: z.array(z.string()).default([]),
	})
	.superRefine((value, ctx) => {
		if (!value.specific && value.generic_sentences.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["generic_sentences"],
				message:
					"generic_sentences must include at least one quote when specific is false",
			});
		}
	});

export const AbstractNounTrapSchema = z
	.object({
		concrete: z.boolean(),
		offending_nouns: z.array(z.string()).default([]),
		rationale: z.array(z.string()).default([]),
	})
	.superRefine((value, ctx) => {
		if (!value.concrete && value.offending_nouns.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["offending_nouns"],
				message:
					"offending_nouns must include at least one quote when concrete is false",
			});
		}
	});

export const EssayisticRegisterSchema = z
	.object({
		conversational: z.boolean(),
		essayistic_phrases: z.array(z.string()).default([]),
		rationale: z.array(z.string()).default([]),
	})
	.superRefine((value, ctx) => {
		if (!value.conversational && value.essayistic_phrases.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["essayistic_phrases"],
				message:
					"essayistic_phrases must include at least one quote when conversational is false",
			});
		}
	});

export const ArcNarrativeSchema = z
	.object({
		narrative: z.boolean(),
		disconnect_points: z.array(z.string()).default([]),
		recap_scenes: z.array(z.string()).default([]),
		rationale: z.array(z.string()).default([]),
	})
	.superRefine((value, ctx) => {
		if (
			!value.narrative &&
			value.disconnect_points.length === 0 &&
			value.recap_scenes.length === 0
		) {
			ctx.addIssue({
				code: "custom",
				path: ["disconnect_points"],
				message:
					"when narrative is false, cite evidence: disconnect_points (beats don't connect) and/or recap_scenes (a scene is flat event-recap)",
			});
		}
	});

// The lens is the read's thesis (concept-lens-vocabulary.md §0). This judge asks two
// things at once: does the `take` actually argue the named `lens` (or is the lens
// decorative?), and — the SURFACE-abuse backstop (§10, comparison-notes §6.2) — when
// the lens is a thin/descriptive one, is the song genuinely thin, or did the read bury
// real depth the lens ignored? Evidence is required whenever it fails.
export const LensCoherenceSchema = z
	.object({
		coherent: z.boolean(),
		problems: z.array(z.string()).default([]),
		rationale: z.array(z.string()).default([]),
	})
	.superRefine((value, ctx) => {
		if (!value.coherent && value.problems.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["problems"],
				message:
					"problems must name at least one issue when coherent is false",
			});
		}
	});

export type RegisterSpecificity = z.infer<typeof RegisterSpecificitySchema>;
export type AbstractNounTrap = z.infer<typeof AbstractNounTrapSchema>;
export type EssayisticRegister = z.infer<typeof EssayisticRegisterSchema>;
export type ArcNarrative = z.infer<typeof ArcNarrativeSchema>;
export type LensCoherence = z.infer<typeof LensCoherenceSchema>;

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

export const JourneyNarrativeSchema = z
	.object({
		narrative: z.boolean(),
		disconnect_points: z.array(z.string()).default([]),
		rationale: z.array(z.string()).default([]),
	})
	.superRefine((value, ctx) => {
		if (!value.narrative && value.disconnect_points.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["disconnect_points"],
				message:
					"disconnect_points must include at least one quote when narrative is false",
			});
		}
	});

export type RegisterSpecificity = z.infer<typeof RegisterSpecificitySchema>;
export type AbstractNounTrap = z.infer<typeof AbstractNounTrapSchema>;
export type EssayisticRegister = z.infer<typeof EssayisticRegisterSchema>;
export type JourneyNarrative = z.infer<typeof JourneyNarrativeSchema>;

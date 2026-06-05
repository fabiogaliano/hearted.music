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

// Opus reaches this judge through the `claude` CLI and hand-parsed JSON (not generateObject),
// and it occasionally returns an evidence item as a { claim, reason } object instead of a
// string. Coerce such objects to one readable string so a well-reasoned flag is never lost to
// a shape mismatch; plain strings (what the Gemini judges and the schema tests pass) flow
// through untouched.
const coercedStringArray = z.preprocess((val) => {
	if (!Array.isArray(val)) return val;
	return val.map((el) => {
		if (typeof el === "string") return el;
		if (el && typeof el === "object") {
			const parts = Object.values(el as Record<string, unknown>).filter(
				(v): v is string => typeof v === "string",
			);
			return parts.length ? parts.join(" — ") : JSON.stringify(el);
		}
		return String(el);
	});
}, z.array(z.string()).default([]));

// Grounding (GRD-1/2/3/6, IMG-3) — the priority-1 judge. Flags any field whose content
// can't be traced to a heard lyric or a vote-gated annotation (> 15 votes). `grounded`
// is the gate; `paratextual_flags` is GRD-5's human-review surface (cover art / video tie)
// which is NOT an auto-fail, so it rides alongside without forcing `grounded: false`.
export const GroundingSchema = z
	.object({
		grounded: z.boolean(),
		ungrounded_claims: coercedStringArray,
		paratextual_flags: coercedStringArray,
		rationale: coercedStringArray,
	})
	.superRefine((value, ctx) => {
		if (!value.grounded && value.ungrounded_claims.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["ungrounded_claims"],
				message:
					"ungrounded_claims must name at least one imported claim when grounded is false",
			});
		}
	});

// Redundancy (XCT-1 / ARC-8 / LIN-8 / CON-2) — each field must earn its keep. Flags
// cross-field duplication: a scene that repeats the take, a `lines` quote that duplicates
// what image/take already spend, a contradiction that restates take or lens. Load-bearing
// spine repetition (As It Was lands "as it was" in take and scene on purpose, TYP-3) is NOT
// redundancy and must pass.
export const RedundancySchema = z
	.object({
		distinct: z.boolean(),
		redundant_pairs: z.array(z.string()).default([]),
		rationale: z.array(z.string()).default([]),
	})
	.superRefine((value, ctx) => {
		if (!value.distinct && value.redundant_pairs.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["redundant_pairs"],
				message:
					"redundant_pairs must name at least one duplicated field pair when distinct is false",
			});
		}
	});

// Voice-softness (SFT-1 / SFT-5 / SFT-7) — one combined judge returning per-check hits.
// Calibrated entirely against the golds, which legitimately end on short active turns
// ("It becomes a vow.") and are fragment-rich by design — the *button* and the *pile* are
// the tells, not the turn or the single landing fragment.
export const VoiceSoftnessSchema = z
	.object({
		clean: z.boolean(),
		kicker_hits: z.array(z.string()).default([]),
		fragment_hits: z.array(z.string()).default([]),
		parallelism_hits: z.array(z.string()).default([]),
		rationale: z.array(z.string()).default([]),
	})
	.superRefine((value, ctx) => {
		if (
			!value.clean &&
			value.kicker_hits.length === 0 &&
			value.fragment_hits.length === 0 &&
			value.parallelism_hits.length === 0
		) {
			ctx.addIssue({
				code: "custom",
				path: ["kicker_hits"],
				message:
					"when clean is false, cite evidence in kicker_hits, fragment_hits, and/or parallelism_hits",
			});
		}
	});

export type RegisterSpecificity = z.infer<typeof RegisterSpecificitySchema>;
export type AbstractNounTrap = z.infer<typeof AbstractNounTrapSchema>;
export type EssayisticRegister = z.infer<typeof EssayisticRegisterSchema>;
export type ArcNarrative = z.infer<typeof ArcNarrativeSchema>;
export type LensCoherence = z.infer<typeof LensCoherenceSchema>;
export type Grounding = z.infer<typeof GroundingSchema>;
export type Redundancy = z.infer<typeof RedundancySchema>;
export type VoiceSoftness = z.infer<typeof VoiceSoftnessSchema>;

import { describe, expect, it } from "vitest";
import {
	AbstractNounTrapSchema,
	ArcNarrativeSchema,
	EssayisticRegisterSchema,
	GroundingSchema,
	LensCoherenceSchema,
	RedundancySchema,
	RegisterSpecificitySchema,
	VoiceSoftnessSchema,
} from "../tier2/schemas";

describe("tier2 schemas", () => {
	it("requires evidence arrays when a judge fails", () => {
		expect(
			RegisterSpecificitySchema.safeParse({
				specific: false,
				generic_sentences: [],
				rationale: [],
			}).success,
		).toBe(false);
		expect(
			AbstractNounTrapSchema.safeParse({
				concrete: false,
				offending_nouns: [],
				rationale: [],
			}).success,
		).toBe(false);
		expect(
			EssayisticRegisterSchema.safeParse({
				conversational: false,
				essayistic_phrases: [],
				rationale: [],
			}).success,
		).toBe(false);
		expect(
			ArcNarrativeSchema.safeParse({
				narrative: false,
				disconnect_points: [],
				rationale: [],
			}).success,
		).toBe(false);
		expect(
			LensCoherenceSchema.safeParse({
				coherent: false,
				problems: [],
				rationale: [],
			}).success,
		).toBe(false);
		expect(
			GroundingSchema.safeParse({
				grounded: false,
				ungrounded_claims: [],
				paratextual_flags: [],
				rationale: [],
			}).success,
		).toBe(false);
		expect(
			RedundancySchema.safeParse({
				distinct: false,
				redundant_pairs: [],
				rationale: [],
			}).success,
		).toBe(false);
		expect(
			VoiceSoftnessSchema.safeParse({
				clean: false,
				kicker_hits: [],
				fragment_hits: [],
				parallelism_hits: [],
				rationale: [],
			}).success,
		).toBe(false);
	});

	it("allows empty evidence arrays when a judge passes", () => {
		expect(
			RegisterSpecificitySchema.safeParse({
				specific: true,
				generic_sentences: [],
				rationale: [],
			}).success,
		).toBe(true);
		expect(
			AbstractNounTrapSchema.safeParse({
				concrete: true,
				offending_nouns: [],
				rationale: [],
			}).success,
		).toBe(true);
		expect(
			EssayisticRegisterSchema.safeParse({
				conversational: true,
				essayistic_phrases: [],
				rationale: [],
			}).success,
		).toBe(true);
		expect(
			ArcNarrativeSchema.safeParse({
				narrative: true,
				disconnect_points: [],
				rationale: [],
			}).success,
		).toBe(true);
		expect(
			LensCoherenceSchema.safeParse({
				coherent: true,
				problems: [],
				rationale: [],
			}).success,
		).toBe(true);
		expect(
			GroundingSchema.safeParse({
				grounded: true,
				ungrounded_claims: [],
				paratextual_flags: [],
				rationale: [],
			}).success,
		).toBe(true);
		expect(
			RedundancySchema.safeParse({
				distinct: true,
				redundant_pairs: [],
				rationale: [],
			}).success,
		).toBe(true);
		expect(
			VoiceSoftnessSchema.safeParse({
				clean: true,
				kicker_hits: [],
				fragment_hits: [],
				parallelism_hits: [],
				rationale: [],
			}).success,
		).toBe(true);
	});

	it("treats a paratextual flag as non-failing — grounded can stay true", () => {
		// GRD-5: a cover-art / music-video tie is surfaced for human review, never an
		// auto-fail, so paratextual_flags may be populated while grounded is true.
		expect(
			GroundingSchema.safeParse({
				grounded: true,
				ungrounded_claims: [],
				paratextual_flags: ["image leans on the music video's neon palette"],
				rationale: [],
			}).success,
		).toBe(true);
	});

	it("treats a flat-recap scene as a valid arc failure on its own", () => {
		expect(
			ArcNarrativeSchema.safeParse({
				narrative: false,
				disconnect_points: [],
				recap_scenes: ["scene 2: recounts the bars without a turn"],
				rationale: [],
			}).success,
		).toBe(true);
	});
});

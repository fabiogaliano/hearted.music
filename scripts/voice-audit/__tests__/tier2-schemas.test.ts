import { describe, expect, it } from "vitest";
import {
	AbstractNounTrapSchema,
	EssayisticRegisterSchema,
	JourneyNarrativeSchema,
	RegisterSpecificitySchema,
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
			JourneyNarrativeSchema.safeParse({
				narrative: false,
				disconnect_points: [],
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
			JourneyNarrativeSchema.safeParse({
				narrative: true,
				disconnect_points: [],
				rationale: [],
			}).success,
		).toBe(true);
	});
});

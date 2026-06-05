import { describe, expect, it } from "vitest";
import {
	AbstractNounTrapSchema,
	ArcNarrativeSchema,
	EssayisticRegisterSchema,
	LensCoherenceSchema,
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

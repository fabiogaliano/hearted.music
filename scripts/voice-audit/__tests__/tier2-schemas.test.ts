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
				supporting_evidence: ['lens ← "We gotta freeze them up"'],
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
				supporting_evidence: ['image ← "neon" in the lyrics'],
				ungrounded_claims: [],
				paratextual_flags: ["image leans on the music video's neon palette"],
				rationale: [],
			}).success,
		).toBe(true);
	});

	// WP4 cite-or-fail: a grounded read must show the evidence that grounds it. A pass with no
	// supporting_evidence is rejected; the same object with a citation is accepted.
	it("requires supporting_evidence whenever grounded is true (cite or fail)", () => {
		expect(
			GroundingSchema.safeParse({
				grounded: true,
				supporting_evidence: [],
				ungrounded_claims: [],
				paratextual_flags: [],
				rationale: [],
			}).success,
		).toBe(false);
		expect(
			GroundingSchema.safeParse({
				grounded: true,
				supporting_evidence: ['take ← "No sex for Ben Rymer"'],
				ungrounded_claims: [],
				paratextual_flags: [],
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

	// WP3: every judge must reason before it decides. generateObject emits fields in schema
	// order, and Zod's parser writes output keys in that same definition order, so asserting
	// the parsed key order pins the contract the model actually sees. rationale leads; the
	// verdict boolean trails.
	it("orders every judge rationale-first, verdict-last", () => {
		const cases: Array<{
			name: string;
			schema: { parse: (v: unknown) => Record<string, unknown> };
			verdict: string;
			// Minimal passing input; grounding needs a citation to clear cite-or-fail.
			pass: Record<string, unknown>;
		}> = [
			{ name: "register-specificity", schema: RegisterSpecificitySchema, verdict: "specific", pass: { specific: true } },
			{ name: "abstract-noun-trap", schema: AbstractNounTrapSchema, verdict: "concrete", pass: { concrete: true } },
			{ name: "essayistic-register", schema: EssayisticRegisterSchema, verdict: "conversational", pass: { conversational: true } },
			{ name: "arc-narrative", schema: ArcNarrativeSchema, verdict: "narrative", pass: { narrative: true } },
			{ name: "lens-coherence", schema: LensCoherenceSchema, verdict: "coherent", pass: { coherent: true } },
			{ name: "grounding", schema: GroundingSchema, verdict: "grounded", pass: { grounded: true, supporting_evidence: ["x"] } },
			{ name: "redundancy", schema: RedundancySchema, verdict: "distinct", pass: { distinct: true } },
			{ name: "voice-softness", schema: VoiceSoftnessSchema, verdict: "clean", pass: { clean: true } },
		];
		for (const { name, schema, verdict, pass } of cases) {
			const keys = Object.keys(schema.parse(pass));
			expect(keys[0], `${name} should lead with rationale`).toBe("rationale");
			expect(keys[keys.length - 1], `${name} should decide ${verdict} last`).toBe(verdict);
		}
	});
});

import { describe, expect, it } from "vitest";
import { loadGoldExemplars } from "../exemplars";
import { dashes } from "../tier1/rules";
import { lensCoherencePrompt } from "../tier2/prompts/lens-coherence";

describe("promoted gold exemplars", () => {
	const golds = [...loadGoldExemplars().values()];

	it("loads and validates all four reads through ConceptReadSchema", () => {
		// loadGoldExemplars parses each .read through ConceptReadSchema, so reaching here
		// means all four validated.
		expect(golds.map((g) => g.key).sort()).toEqual([
			"blinding-lights",
			"drivers-license",
			"motion-sickness",
			"not-like-us",
		]);
	});

	it("has no surviving dashes — the Tier-1 rule they anchor", () => {
		// The brief's promotion requirement: normalize dashes so the golds don't fail the
		// Tier-1 dash rule they are meant to anchor. (Other Tier-1 rules are NOT gated on
		// the golds — they anchor the pairwise judge, not the deterministic linter. See
		// the participial-closure finding in session-5-voice-audit-migration.md.)
		for (const g of golds) {
			expect(dashes(g.read)).toEqual([]);
		}
	});
});

describe("lens-coherence judge prompt", () => {
	const golds = [...loadGoldExemplars().values()];

	it("gives the judge the lens, the take, and the SURFACE-abuse check", () => {
		for (const g of golds) {
			const prompt = lensCoherencePrompt(g.read);
			expect(prompt).toContain(g.read.lens);
			expect(prompt).toContain(g.read.take);
			// The inverse-failure backstop (comparison-notes §6.2) must be in the rubric.
			expect(prompt.toUpperCase()).toContain("SURFACE");
			expect(prompt).toContain("decoration");
		}
	});
});

import { describe, expect, it } from "vitest";
import { loadGoldExemplars } from "../exemplars";
import { dashes, runAllRules } from "../tier1/rules";
import { lensCoherencePrompt } from "../tier2/prompts/lens-coherence";

describe("promoted gold exemplars", () => {
	const golds = [...loadGoldExemplars().values()];

	it("loads and validates all nine reads through ConceptReadSchema", () => {
		// loadGoldExemplars parses each .read through ConceptReadSchema, so reaching here
		// means all nine validated. The original four were promoted in Session 5; the five
		// variance-spanning golds (dtmf, no-sex-for-ben, beautiful-things, pink-pony-club,
		// as-it-was) were added in Session 5.5-continued.
		expect(golds.map((g) => g.key).sort()).toEqual([
			"as-it-was",
			"beautiful-things",
			"blinding-lights",
			"drivers-license",
			"dtmf",
			"motion-sickness",
			"no-sex-for-ben",
			"not-like-us",
			"pink-pony-club",
		]);
	});

	it("every gold produces zero HIGH and zero MEDIUM tier-1 hits (Phase 1 gate)", () => {
		// Golds are the standing authority — a failure is a real conflict to fix by hand (fix
		// the gold and log it, or scope the rule), never by weakening this assertion. LOW
		// rules are diagnostic/non-gating, so only high/medium count.
		for (const g of golds) {
			const gating = runAllRules(g.read).filter(
				(h) => h.severity === "high" || h.severity === "medium",
			);
			expect(
				gating,
				`${g.key}: ${gating
					.map((h) => `${h.rule}@${h.field}:"${h.span}"`)
					.join(", ")}`,
			).toEqual([]);
		}
	});

	it("has no surviving MEDIUM dashes - the Tier-1 fingerprint they anchor", () => {
		// Golds may keep LOW paired-parenthetical dashes: a balanced aside is deliberate
		// punctuation, not the AI tell. They must carry zero MEDIUM dashes: the trailing,
		// clause-ending em dash that is the actual fingerprint. rules.ts splits paired (low)
		// from trailing (medium); this gate enforces only the medium tier on the golds.
		for (const g of golds) {
			const trailing = dashes(g.read).filter((h) => h.severity !== "low");
			expect(trailing).toEqual([]);
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

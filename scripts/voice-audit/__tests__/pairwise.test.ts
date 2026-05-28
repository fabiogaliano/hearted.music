import { describe, expect, it } from "vitest";
import { parseVerdict, reconcile } from "../tier2/pairwise";

const validVerdict = JSON.stringify({
	per_dimension: {
		warmth_attention: "A",
		image_specificity: "B",
		direct_interpretation: "tie",
		human_rhythm: "A",
		absence_of_ai_tells: "A",
	},
	ai_tells_found: { A: [], B: ["serves as"] },
	winner: "A",
	confidence: "high",
	rationale: "A reads warmer.",
});

describe("parseVerdict", () => {
	it("parses a bare JSON object", () => {
		expect(parseVerdict(validVerdict).winner).toBe("A");
	});
	it("parses JSON wrapped in a code fence", () => {
		expect(parseVerdict(`\`\`\`json\n${validVerdict}\n\`\`\``).winner).toBe("A");
	});
	it("parses JSON surrounded by stray prose", () => {
		expect(parseVerdict(`Here is my verdict:\n${validVerdict}\nThanks.`).winner).toBe("A");
	});
	it("throws on a missing required field", () => {
		expect(() => parseVerdict('{"winner":"A"}')).toThrow();
	});
});

describe("reconcile", () => {
	// run1 labels first=A; run2 labels first=B (swapped).
	it("agrees on first when both runs point at the first analysis", () => {
		// run1 picks A(=first), run2 picks B(=first)
		expect(reconcile("A", "B")).toEqual({ winner: "first", agreement: true, confidence: "high" });
	});
	it("agrees on second when both runs point at the second analysis", () => {
		// run1 picks B(=second), run2 picks A(=second)
		expect(reconcile("B", "A")).toEqual({ winner: "second", agreement: true, confidence: "high" });
	});
	it("calls a position-flip a low-confidence tie", () => {
		// run1 picks A(=first), run2 picks A(=second) -> contradiction
		expect(reconcile("A", "A")).toEqual({ winner: "tie", agreement: false, confidence: "low" });
	});
	it("leans to the decisive call when one run ties", () => {
		// run1 tie, run2 picks B(=first)
		expect(reconcile("tie", "B")).toEqual({
			winner: "first",
			agreement: false,
			confidence: "medium",
		});
	});
	it("treats a double tie as a medium-confidence tie", () => {
		expect(reconcile("tie", "tie")).toEqual({
			winner: "tie",
			agreement: true,
			confidence: "medium",
		});
	});
});

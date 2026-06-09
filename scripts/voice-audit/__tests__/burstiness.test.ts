import { describe, expect, it } from "vitest";
import {
	coefficientOfVariation,
	sentenceLengthCV,
	splitSentences,
} from "@/lib/domains/enrichment/content-analysis/voice/burstiness";

describe("splitSentences", () => {
	it("splits on terminator + whitespace", () => {
		expect(splitSentences("One. Two! Three?")).toEqual([
			"One.",
			"Two!",
			"Three?",
		]);
	});

	it("ignores trailing whitespace", () => {
		expect(splitSentences("  Only one sentence.  ")).toEqual([
			"Only one sentence.",
		]);
	});
});

describe("coefficientOfVariation", () => {
	it("returns null with fewer than three samples", () => {
		expect(coefficientOfVariation([5, 10])).toBeNull();
	});

	it("returns 0 when all values are equal", () => {
		expect(coefficientOfVariation([8, 8, 8, 8])).toBe(0);
	});

	it("rises with variance", () => {
		const flat = coefficientOfVariation([10, 11, 9, 10]) ?? 0;
		const bursty = coefficientOfVariation([2, 18, 4, 20, 1]) ?? 0;
		expect(bursty).toBeGreaterThan(flat);
	});
});

describe("sentenceLengthCV", () => {
	it("flags flat rhythm below the threshold", () => {
		const flat =
			"Word word word word word. Word word word word word. Word word word word word.";
		expect(sentenceLengthCV(flat)).toBe(0);
	});

	it("rewards bursty rhythm with higher CV", () => {
		const bursty =
			"No. This is the longest sentence in the entire paragraph by a wide margin. Short.";
		const cv = sentenceLengthCV(bursty);
		expect(cv).not.toBeNull();
		expect(cv ?? 0).toBeGreaterThan(0.3);
	});
});

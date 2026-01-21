/**
 * Tests for the string similarity (Levenshtein) module.
 */

import { describe, expect, it } from "vitest";
import {
	calculateSimilarity,
	normalizeString,
} from "../utils/string-similarity";

describe("normalizeString", () => {
	it("converts to lowercase", () => {
		expect(normalizeString("HELLO")).toBe("hello");
	});

	it("removes accents", () => {
		expect(normalizeString("café")).toBe("cafe");
		expect(normalizeString("naïve")).toBe("naive");
	});

	it("removes parenthetical content", () => {
		expect(normalizeString("Song (feat. Artist)")).toBe("song");
	});

	it("removes feat/ft patterns", () => {
		expect(normalizeString("Song feat. Artist")).toBe("song artist");
	});

	it("removes special characters", () => {
		expect(normalizeString("Hello! World?")).toBe("hello world");
	});

	it("collapses multiple spaces", () => {
		expect(normalizeString("hello    world")).toBe("hello world");
	});
});

describe("calculateSimilarity", () => {
	it("returns 1.0 for identical strings", () => {
		expect(calculateSimilarity("hello", "hello")).toBe(1);
	});

	it("returns 1.0 for same strings with different case", () => {
		expect(calculateSimilarity("Hello", "HELLO")).toBe(1);
	});

	it("returns 0.9 for substring containment", () => {
		expect(calculateSimilarity("hello world", "hello")).toBe(0.9);
		expect(calculateSimilarity("hello", "hello world")).toBe(0.9);
	});

	it("returns 0 for empty strings after normalization", () => {
		expect(calculateSimilarity("", "hello")).toBe(0);
		expect(calculateSimilarity("hello", "")).toBe(0);
	});

	it("calculates Levenshtein-based similarity", () => {
		// "kitten" -> "sitting" has distance 3
		// Max length = 7, similarity = 1 - 3/7 ≈ 0.57
		const similarity = calculateSimilarity("kitten", "sitting");
		expect(similarity).toBeGreaterThan(0.5);
		expect(similarity).toBeLessThan(0.7);
	});

	it("handles accented characters correctly", () => {
		// "café" and "cafe" should match after normalization
		expect(calculateSimilarity("café", "cafe")).toBe(1);
	});
});

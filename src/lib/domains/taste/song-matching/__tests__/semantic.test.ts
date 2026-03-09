/**
 * Tests for semantic matching utilities.
 */

import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "../semantic";

// ============================================================================
// cosineSimilarity
// ============================================================================

describe("cosineSimilarity", () => {
	// Crash prevention tests
	it("returns 0 for empty vectors", () => {
		expect(cosineSimilarity([], [])).toBe(0);
	});

	it("returns 0 for different length vectors", () => {
		expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
		expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
	});

	it("returns 0 for zero vectors", () => {
		expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
		expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
		expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
	});

	// Correctness tests
	it("returns 1 for identical vectors", () => {
		expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
		expect(cosineSimilarity([5, 5, 5], [5, 5, 5])).toBeCloseTo(1);
		expect(cosineSimilarity([0.1, 0.2, 0.3], [0.1, 0.2, 0.3])).toBeCloseTo(1);
	});

	it("returns 1 for scaled versions of same vector", () => {
		// [2,4,6] is just [1,2,3] * 2 - same direction
		const sim = cosineSimilarity([1, 2, 3], [2, 4, 6]);
		expect(sim).toBeCloseTo(1);
	});

	it("returns 0 for orthogonal vectors", () => {
		// [1,0] and [0,1] are perpendicular
		expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);

		// [1,0,0] and [0,1,0] are perpendicular
		expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
	});

	it("returns -1 for opposite vectors", () => {
		const sim = cosineSimilarity([1, 2, 3], [-1, -2, -3]);
		expect(sim).toBeCloseTo(-1);
	});

	it("returns ~0.707 for 45-degree angle", () => {
		// [1,1] and [1,0] form 45-degree angle
		// cos(45°) = √2/2 ≈ 0.707
		const sim = cosineSimilarity([1, 1], [1, 0]);
		expect(sim).toBeCloseTo(0.707, 2);
	});

	it("returns ~0.866 for 30-degree angle", () => {
		// [√3, 1] and [1, 0] form 30-degree angle
		// cos(30°) = √3/2 ≈ 0.866
		const sim = cosineSimilarity([Math.sqrt(3), 1], [1, 0]);
		expect(sim).toBeCloseTo(0.866, 2);
	});

	it("handles negative values correctly", () => {
		const sim = cosineSimilarity([-1, -2, -3], [-1, -2, -3]);
		expect(sim).toBe(1);
	});

	it("handles decimal values correctly", () => {
		const sim = cosineSimilarity([0.1, 0.2, 0.3], [0.1, 0.2, 0.3]);
		expect(sim).toBeCloseTo(1);
	});

	it("handles high-dimensional vectors", () => {
		// Test with 128-dimensional vectors (common embedding size)
		const vec1 = Array.from({ length: 128 }, (_, i) => i * 0.01);
		const vec2 = Array.from({ length: 128 }, (_, i) => i * 0.01);
		const sim = cosineSimilarity(vec1, vec2);
		expect(sim).toBeCloseTo(1);
	});
});

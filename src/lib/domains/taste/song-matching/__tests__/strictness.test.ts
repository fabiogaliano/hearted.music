import { describe, expect, it } from "vitest";
import { strictnessScore } from "../strictness";

describe("strictnessScore", () => {
	it("returns fused_score when present", () => {
		expect(strictnessScore({ score: 0.9, fused_score: 0.7 })).toBe(0.7);
	});

	it("falls back to score when fused_score is null", () => {
		expect(strictnessScore({ score: 0.8, fused_score: null })).toBe(0.8);
	});

	it("returns fused_score even when it is lower than score", () => {
		// Reranker may push score higher; strictness must use the pre-rerank fused value.
		expect(strictnessScore({ score: 0.95, fused_score: 0.6 })).toBe(0.6);
	});

	it("returns fused_score of 0 rather than falling back to score", () => {
		// fused_score: 0 is a valid score, not absent — must not be treated as falsy.
		expect(strictnessScore({ score: 0.8, fused_score: 0 })).toBe(0);
	});
});

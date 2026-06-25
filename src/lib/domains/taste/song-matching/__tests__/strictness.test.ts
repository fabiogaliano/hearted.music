import { describe, expect, it } from "vitest";
import {
	DEFAULT_MATCH_STRICTNESS,
	MATCH_STRICTNESS_VALUES,
	type MatchStrictness,
	STRICTNESS_MIN_SCORE,
	strictnessScore,
} from "../strictness";

describe("STRICTNESS_MIN_SCORE mapping", () => {
	it("maps each preset to its read-time floor", () => {
		expect(STRICTNESS_MIN_SCORE.open).toBe(0.35);
		expect(STRICTNESS_MIN_SCORE.balanced).toBe(0.5);
		expect(STRICTNESS_MIN_SCORE.strict).toBe(0.65);
	});

	it("orders loosest → strictest", () => {
		expect(STRICTNESS_MIN_SCORE.open).toBeLessThan(
			STRICTNESS_MIN_SCORE.balanced,
		);
		expect(STRICTNESS_MIN_SCORE.balanced).toBeLessThan(
			STRICTNESS_MIN_SCORE.strict,
		);
	});

	it("the 'open' floor equals the write-time floor (shows everything stored)", () => {
		// Mirrors DEFAULT_MATCHING_CONFIG.minScoreThreshold in config.ts — 'open'
		// must surface every match that survived the write-time floor.
		expect(STRICTNESS_MIN_SCORE.open).toBe(0.35);
	});

	it("has a score for every declared preset value", () => {
		for (const value of MATCH_STRICTNESS_VALUES) {
			expect(typeof STRICTNESS_MIN_SCORE[value as MatchStrictness]).toBe(
				"number",
			);
		}
	});

	it("defaults to 'balanced'", () => {
		expect(DEFAULT_MATCH_STRICTNESS).toBe("balanced");
		expect(MATCH_STRICTNESS_VALUES).toContain(DEFAULT_MATCH_STRICTNESS);
	});
});

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

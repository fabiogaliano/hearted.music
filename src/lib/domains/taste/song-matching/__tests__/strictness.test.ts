import { describe, expect, it } from "vitest";
import {
	DEFAULT_MATCH_STRICTNESS,
	MATCH_STRICTNESS_VALUES,
	type MatchStrictness,
	STRICTNESS_MIN_SCORE,
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

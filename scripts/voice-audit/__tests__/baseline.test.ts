import { describe, expect, it } from "vitest";
import {
	compareToBaseline,
	type Baseline,
} from "../baseline";
import type { LintReport } from "../types";

function report(partial: Partial<LintReport>): LintReport {
	return {
		files: partial.files ?? [],
		totals: partial.totals ?? { low: 0, medium: 0, high: 0 },
		byRule: partial.byRule ?? {},
	};
}

function baseline(partial: Partial<Baseline>): Baseline {
	return {
		generatedAt: "2026-04-22T00:00:00.000Z",
		totals: partial.totals ?? { low: 0, medium: 0, high: 0 },
		byRule: partial.byRule ?? {},
	};
}

describe("compareToBaseline", () => {
	it("does not regress on low-severity-only rule drift", () => {
		const diff = compareToBaseline(
			report({
				totals: { low: 2, medium: 0, high: 0 },
				byRule: { burstiness: 2 },
			}),
			baseline({
				totals: { low: 1, medium: 0, high: 0 },
				byRule: { burstiness: 1 },
			}),
		);

		expect(diff.regressed).toBe(false);
		expect(diff.rulesWorse).toEqual([]);
	});

	it("regresses when a gating rule worsens even if totals stay flat", () => {
		const diff = compareToBaseline(
			report({
				totals: { low: 0, medium: 2, high: 0 },
				byRule: { "puffery-adjective": 2, hedging: 0 },
			}),
			baseline({
				totals: { low: 0, medium: 2, high: 0 },
				byRule: { "puffery-adjective": 1, hedging: 1 },
			}),
		);

		expect(diff.regressed).toBe(true);
		expect(diff.rulesWorse).toEqual([
			{ rule: "puffery-adjective", before: 1, after: 2 },
		]);
	});
});

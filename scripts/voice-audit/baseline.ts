import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { LintReport } from "./types";

const NON_GATING_RULES = new Set(["burstiness", "rule-of-three"]);

export interface Baseline {
	generatedAt: string;
	totals: LintReport["totals"];
	byRule: LintReport["byRule"];
}

export function toBaseline(report: LintReport): Baseline {
	return {
		generatedAt: new Date().toISOString(),
		totals: { ...report.totals },
		byRule: { ...report.byRule },
	};
}

export function writeBaseline(path: string, report: LintReport): Baseline {
	const baseline = toBaseline(report);
	writeFileSync(path, JSON.stringify(baseline, null, 2) + "\n", "utf-8");
	return baseline;
}

export function readBaseline(path: string): Baseline | null {
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, "utf-8")) as Baseline;
}

export interface BaselineDiff {
	regressed: boolean;
	totals: {
		high: { before: number; after: number };
		medium: { before: number; after: number };
		low: { before: number; after: number };
	};
	rulesWorse: Array<{ rule: string; before: number; after: number }>;
}

export function compareToBaseline(
	report: LintReport,
	baseline: Baseline,
): BaselineDiff {
	const rulesWorse: BaselineDiff["rulesWorse"] = [];
	for (const [rule, count] of Object.entries(report.byRule)) {
		if (NON_GATING_RULES.has(rule)) continue;
		const before = baseline.byRule[rule] ?? 0;
		if (count > before) rulesWorse.push({ rule, before, after: count });
	}

	const regressed =
		report.totals.high > baseline.totals.high ||
		report.totals.medium > baseline.totals.medium ||
		rulesWorse.length > 0;

	return {
		regressed,
		totals: {
			high: { before: baseline.totals.high, after: report.totals.high },
			medium: { before: baseline.totals.medium, after: report.totals.medium },
			low: { before: baseline.totals.low, after: report.totals.low },
		},
		rulesWorse,
	};
}

export function summarizeDiff(diff: BaselineDiff): string {
	const lines: string[] = [];
	const verdict = diff.regressed ? "REGRESSED" : "OK";
	lines.push(`Baseline comparison: ${verdict}`);
	for (const [sev, t] of Object.entries(diff.totals)) {
		const delta = t.after - t.before;
		const sign = delta > 0 ? `+${delta}` : String(delta);
		lines.push(`  ${sev}: ${t.before} → ${t.after} (${sign})`);
	}
	for (const r of diff.rulesWorse) {
		lines.push(`  WORSE  ${r.rule}: ${r.before} → ${r.after}`);
	}
	return lines.join("\n");
}

import { readFileSync } from "node:fs";
import path from "node:path";
import {
	SongAnalysisLyricalSchema,
	type SongAnalysisLyrical,
	type SongAnalysisResult,
} from "@/lib/domains/enrichment/content-analysis/song-analysis";
import type {
	FileReport,
	LintReport,
	RuleHit,
	Severity,
} from "../types";
import { isLyricalShape } from "../types";
import { runAllRules } from "./rules";

export interface SeverityBudget {
	maxHigh: number;
	maxMedium: number;
}

export const DEFAULT_SEVERITY_BUDGET: SeverityBudget = {
	maxHigh: 0,
	maxMedium: 2,
};

export function emptyReport(): LintReport {
	return {
		files: [],
		totals: { low: 0, medium: 0, high: 0 },
		byRule: {},
	};
}

function addHits(report: LintReport, file: FileReport, hits: RuleHit[]) {
	file.hits.push(...hits);
	for (const h of hits) {
		report.totals[h.severity]++;
		report.byRule[h.rule] = (report.byRule[h.rule] ?? 0) + 1;
	}
}

export function auditAnalysis(
	source: string,
	analysis: SongAnalysisLyrical,
	songId?: string,
): { file: FileReport; hits: RuleHit[] } {
	const file: FileReport = { source, songId, hits: [] };
	const hits = runAllRules(analysis);
	file.hits.push(...hits);
	return { file, hits };
}

export function extractAnalysis(raw: unknown): {
	songId?: string;
	analysis: SongAnalysisResult | null;
} {
	if (!raw || typeof raw !== "object") return { analysis: null };
	const wrapper = raw as Record<string, unknown>;
	const songId =
		typeof wrapper.spotifyTrackId === "string"
			? wrapper.spotifyTrackId
			: undefined;
	const candidate =
		wrapper.analysis && typeof wrapper.analysis === "object"
			? (wrapper.analysis as Record<string, unknown>)
			: wrapper;
	if (!("headline" in candidate) || !("compound_mood" in candidate)) {
		return { songId, analysis: null };
	}
	return { songId, analysis: candidate as unknown as SongAnalysisResult };
}

export function auditFile(
	filePath: string,
	report: LintReport = emptyReport(),
): LintReport {
	const absolute = path.isAbsolute(filePath)
		? filePath
		: path.resolve(process.cwd(), filePath);
	const raw = JSON.parse(readFileSync(absolute, "utf-8"));
	const { songId, analysis } = extractAnalysis(raw);
	const file: FileReport = { source: absolute, songId, hits: [] };

	if (!analysis) {
		report.files.push(file);
		return report;
	}

	if (!isLyricalShape(analysis)) {
		file.skipped = "instrumental";
		report.files.push(file);
		return report;
	}

	const parsed = SongAnalysisLyricalSchema.safeParse(analysis);
	if (!parsed.success) {
		report.files.push(file);
		return report;
	}

	addHits(report, file, runAllRules(parsed.data));
	report.files.push(file);
	return report;
}

export function auditFiles(paths: string[]): LintReport {
	const report = emptyReport();
	for (const p of paths) {
		auditFile(p, report);
	}
	return report;
}

export function exceedsBudget(
	report: LintReport,
	budget: SeverityBudget = DEFAULT_SEVERITY_BUDGET,
): boolean {
	return (
		report.totals.high > budget.maxHigh ||
		report.totals.medium > budget.maxMedium
	);
}

export function summarize(report: LintReport): string {
	const lines: string[] = [];
	const totals = report.totals;
	lines.push(
		`Tier 1: ${report.files.length} files — ${totals.high} high, ${totals.medium} medium, ${totals.low} low`,
	);
	const sorted = Object.entries(report.byRule).sort((a, b) => b[1] - a[1]);
	for (const [rule, count] of sorted) {
		lines.push(`  ${rule}: ${count}`);
	}
	for (const f of report.files) {
		if (f.hits.length === 0) continue;
		const label = f.songId ?? path.basename(f.source);
		lines.push(`\n${label}`);
		for (const h of f.hits) {
			const note = h.note ? ` (${h.note})` : "";
			lines.push(
				`  [${h.severity}] ${h.rule} @ ${h.field}: "${h.span}"${note}`,
			);
		}
	}
	return lines.join("\n");
}

type Severity_ = Severity;
export type { Severity_ as Severity };

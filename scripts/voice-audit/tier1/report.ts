import { readFileSync } from "node:fs";
import path from "node:path";
import {
	SongReadSchema,
	type SongRead,
} from "@/lib/domains/enrichment/content-analysis/read-schema";
import type {
	FileReport,
	LintReport,
	RuleHit,
	Severity,
} from "../types";
import { isSongReadShape } from "../types";
import { runAllRules } from "@/lib/domains/enrichment/content-analysis/voice/tier1-rules";

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
	read: SongRead,
	songId?: string,
): { file: FileReport; hits: RuleHit[] } {
	const file: FileReport = { source, songId, hits: [] };
	const hits = runAllRules(read);
	file.hits.push(...hits);
	return { file, hits };
}

// Unwraps a stored record to its read sub-object. Three on-disk containers exist: a
// gold exemplar ({ read }), an experiment run ({ spotifyTrackId, analysis }), and a
// bare read. Anything not in the redesigned shape (legacy 8-field rows, instrumentals)
// returns null so the caller can skip it — old rows re-enrich via v14.
export function extractAnalysis(raw: unknown): {
	songId?: string;
	read: SongRead | null;
} {
	if (!raw || typeof raw !== "object") return { read: null };
	const wrapper = raw as Record<string, unknown>;
	const songId =
		typeof wrapper.spotifyTrackId === "string"
			? wrapper.spotifyTrackId
			: undefined;
	const candidate =
		wrapper.read && typeof wrapper.read === "object"
			? wrapper.read
			: wrapper.analysis && typeof wrapper.analysis === "object"
				? wrapper.analysis
				: wrapper;
	if (!isSongReadShape(candidate)) {
		return { songId, read: null };
	}
	return { songId, read: candidate };
}

export function auditFile(
	filePath: string,
	report: LintReport = emptyReport(),
): LintReport {
	const absolute = path.isAbsolute(filePath)
		? filePath
		: path.resolve(process.cwd(), filePath);
	const raw = JSON.parse(readFileSync(absolute, "utf-8"));
	const { songId, read } = extractAnalysis(raw);
	const file: FileReport = { source: absolute, songId, hits: [] };

	if (!read) {
		// Not the redesigned read shape: a legacy 8-field row or an instrumental.
		file.skipped = "legacy";
		report.files.push(file);
		return report;
	}

	const parsed = SongReadSchema.safeParse(read);
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

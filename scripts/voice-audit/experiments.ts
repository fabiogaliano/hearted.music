// Append-only experiment store for prompt-tuning runs. Each generation writes a
// full record (analysis + hits) and a one-line summary to runs.jsonl, so prompt
// versions stay comparable across iterations instead of living in chat history.

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SongAnalysisLyrical } from "@/lib/domains/enrichment/content-analysis/song-analysis";
import type { RuleHit, Severity } from "./types";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "experiments");
const INDEX = join(DIR, "runs.jsonl");

export interface RunSummary {
	runId: string;
	timestamp: string;
	song: string;
	spotifyTrackId?: string;
	promptKind: "lyrical" | "instrumental";
	promptVersion: string;
	model: string;
	// Undefined means the provider default temperature was used (the historical runs).
	temperature?: number;
	totals: Record<Severity, number>;
	byRule: Record<string, number>;
	tokens?: number;
}

export interface RunRecord extends RunSummary {
	hits: RuleHit[];
	analysis: SongAnalysisLyrical;
}

export function tallyHits(hits: RuleHit[]): {
	totals: Record<Severity, number>;
	byRule: Record<string, number>;
} {
	const totals: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
	const byRule: Record<string, number> = {};
	for (const h of hits) {
		totals[h.severity]++;
		byRule[h.rule] = (byRule[h.rule] ?? 0) + 1;
	}
	return { totals, byRule };
}

function slug(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}

export function makeRunId(
	song: string,
	promptVersion: string,
	model: string,
	temperature?: number,
): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const temp = temperature === undefined ? "" : `__t${slug(String(temperature))}`;
	return `${stamp}__${slug(song)}__v${promptVersion}__${slug(model)}${temp}`;
}

export function recordRun(record: RunRecord): string {
	mkdirSync(DIR, { recursive: true });
	const full = join(DIR, `${record.runId}.json`);
	writeFileSync(full, `${JSON.stringify(record, null, 2)}\n`);

	const summary: RunSummary = {
		runId: record.runId,
		timestamp: record.timestamp,
		song: record.song,
		spotifyTrackId: record.spotifyTrackId,
		promptKind: record.promptKind,
		promptVersion: record.promptVersion,
		model: record.model,
		temperature: record.temperature,
		totals: record.totals,
		byRule: record.byRule,
		tokens: record.tokens,
	};
	appendFileSync(INDEX, `${JSON.stringify(summary)}\n`);
	return full;
}

export function readRunSummaries(): RunSummary[] {
	if (!existsSync(INDEX)) return [];
	return readFileSync(INDEX, "utf-8")
		.split("\n")
		.filter((l) => l.trim())
		.map((l) => JSON.parse(l) as RunSummary);
}

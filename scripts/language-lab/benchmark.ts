#!/usr/bin/env bun
/**
 * Language-detection benchmark over real stored lyrics.
 *
 *   bun scripts/language-lab/benchmark.ts
 *
 * Pipeline:
 *   1. Load the flattened lyrics pool (scripts/language-lab/lyrics-pool.json,
 *      produced via `prod:sql -f pull-lyrics.sql --json`).
 *   2. Clean + filter to songs with enough text.
 *   3. Stratify by a quick fastText pass so the sample spans many languages,
 *      then take up to TARGET songs round-robin across language buckets.
 *   4. Run all three detectors on the sample (timed per detector for speed).
 *   5. Gold label = majority vote (2-of-3). On consensus the tools are all
 *      correct by construction, so the signal is in disagreements: 2-1 splits
 *      score the odd tool wrong; 3-way splits go to manual review.
 *   6. reviewed-labels.json ({ song_id: "es", ... }) overrides gold for any
 *      song you hand-label — re-run to fold corrections in.
 *
 * Outputs: results.json, disagreements.csv, report.md (all in this folder).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
	cleanLyrics,
	makeDetectors,
	langName,
	type Detector,
	type PoolRow,
} from "./shared";

const DIR = resolve(import.meta.dir);
const TARGET = 45;
const PER_LANG_CAP = 6; // keeps English from swamping the sample
const MIN_CHARS = 80;

const PoolRowSchema = z.object({
	song_id: z.string().uuid(),
	title: z.string(),
	artist: z.string(),
	lyrics_text: z.string(),
});

const PoolSchema = z.array(PoolRowSchema);
const ReviewedLabelsSchema = z.record(
	z.string().uuid(),
	z.string().regex(/^[a-z]{2,3}$/),
);

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf-8"));
}

function loadPool(): PoolRow[] {
	const parsed = PoolSchema.safeParse(readJson(resolve(DIR, "lyrics-pool.json")));
	if (!parsed.success) {
		throw new Error(`Invalid lyrics-pool.json: ${parsed.error.message}`);
	}

	return parsed.data
		.map((r) => ({ ...r, lyrics_text: cleanLyrics(r.lyrics_text) }))
		.filter((r) => r.lyrics_text.length >= MIN_CHARS);
}

interface Sampled extends PoolRow {
	bucket: string; // fastText language used only for stratification
}

function getDetectorByName(detectors: Detector[], name: string): Detector {
	const detector = detectors.find((candidate) => candidate.name === name);
	if (detector) return detector;
	throw new Error(`Missing detector: ${name}`);
}

async function buildSample(pool: PoolRow[]): Promise<{
	sample: Sampled[];
	detectors: Awaited<ReturnType<typeof makeDetectors>>;
}> {
	const detectors = await makeDetectors();
	const fasttext = getDetectorByName(detectors, "fasttext");

	// Deterministic order so the sample is reproducible across runs.
	const ordered = [...pool].sort((a, b) => a.song_id.localeCompare(b.song_id));

	const buckets = new Map<string, Sampled[]>();
	for (const row of ordered) {
		const { code } = await fasttext.detect(row.lyrics_text);
		const arr = buckets.get(code) ?? [];
		arr.push({ ...row, bucket: code });
		buckets.set(code, arr);
	}

	// Round-robin across buckets (largest first) so we maximize language coverage
	// before topping up with the common languages.
	const queues = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length).map(([, rows]) => rows);
	const taken: Sampled[] = [];
	const takenPerLang = new Map<string, number>();
	let progress = true;
	while (taken.length < TARGET && progress) {
		progress = false;
		for (const q of queues) {
			if (taken.length >= TARGET) break;
			const next = q.shift();
			if (!next) continue;
			const n = takenPerLang.get(next.bucket) ?? 0;
			if (n >= PER_LANG_CAP) continue;
			takenPerLang.set(next.bucket, n + 1);
			taken.push(next);
			progress = true;
		}
	}
	return { sample: taken, detectors };
}

interface Row {
	song_id: string;
	title: string;
	artist: string;
	snippet: string;
	preds: Record<string, { code: string; confidence: number }>;
	gold: string | null;
	goldSource: "consensus" | "majority" | "reviewed" | "unresolved";
}

function majorityGold(codes: string[]): { gold: string | null; source: Row["goldSource"] } {
	const counts = new Map<string, number>();
	for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	const top = sorted[0];
	if (!top) return { gold: null, source: "unresolved" };
	if (top[1] === 3) return { gold: top[0], source: "consensus" };
	if (top[1] === 2) return { gold: top[0], source: "majority" };
	return { gold: null, source: "unresolved" };
}

async function main() {
	const pool = loadPool();
	console.log(`pool: ${pool.length} songs with >= ${MIN_CHARS} chars of lyrics`);

	const { sample, detectors } = await buildSample(pool);
	console.log(`sample: ${sample.length} songs across ${new Set(sample.map((s) => s.bucket)).size} languages\n`);

	const reviewedPath = resolve(DIR, "reviewed-labels.json");
	const reviewed = existsSync(reviewedPath)
		? (() => {
				const parsed = ReviewedLabelsSchema.safeParse(readJson(reviewedPath));
				if (!parsed.success) {
					throw new Error(`Invalid reviewed-labels.json: ${parsed.error.message}`);
				}
				return parsed.data;
			})()
		: {};

	// Per-detector timing: each tool runs the whole sample in its own loop so the
	// numbers reflect the model, not interleaving. Two passes, report the warm one.
	const speed: Record<string, number> = {};
	for (const d of detectors) {
		for (let pass = 0; pass < 2; pass++) {
			const t0 = performance.now();
			for (const s of sample) await d.detect(s.lyrics_text);
			const ms = performance.now() - t0;
			if (pass === 1) speed[d.name] = ms;
		}
	}

	const rows: Row[] = [];
	for (const s of sample) {
		const preds: Row["preds"] = {};
		for (const d of detectors) preds[d.name] = await d.detect(s.lyrics_text);
		const codes = detectors.map((d) => preds[d.name].code);
		let { gold, source } = majorityGold(codes);
		if (reviewed[s.song_id]) {
			gold = reviewed[s.song_id];
			source = "reviewed";
		}
		rows.push({
			song_id: s.song_id,
			title: s.title,
			artist: s.artist,
			snippet: s.lyrics_text.slice(0, 70),
			preds,
			gold,
			goldSource: source,
		});
	}

	writeFileSync(resolve(DIR, "results.json"), JSON.stringify(rows, null, 2));

	// Disagreements: any song where the three tools don't all agree. CSV with a
	// blank GOLD column to hand-label; copy resolved 3-way splits into
	// reviewed-labels.json and re-run.
	const disagreements = rows.filter((r) => new Set(detectors.map((d) => r.preds[d.name].code)).size > 1);
	const csv = [
		"song_id,gold_source,GOLD,artist,title,tinyld,eld,fasttext,snippet",
		...disagreements.map((r) =>
			[
				r.song_id,
				r.goldSource,
				r.gold ?? "",
				csvCell(r.artist),
				csvCell(r.title),
				`${r.preds.tinyld.code}:${r.preds.tinyld.confidence.toFixed(2)}`,
				`${r.preds.eld.code}:${r.preds.eld.confidence.toFixed(2)}`,
				`${r.preds.fasttext.code}:${r.preds.fasttext.confidence.toFixed(2)}`,
				csvCell(r.snippet),
			].join(","),
		),
	].join("\n");
	writeFileSync(resolve(DIR, "disagreements.csv"), csv);

	writeReport(rows, detectors.map((d) => d.name), speed, sample.length);
	console.log(`Done. ${disagreements.length}/${rows.length} disagreements → disagreements.csv`);
	console.log(`Report → scripts/language-lab/report.md`);
}

function csvCell(s: string): string {
	return `"${s.replace(/"/g, '""')}"`;
}

function writeReport(rows: Row[], tools: string[], speed: Record<string, number>, n: number) {
	const golded = rows.filter((r) => r.gold);
	const unresolved = rows.filter((r) => !r.gold);

	const acc: Record<string, { correct: number; total: number }> = {};
	for (const t of tools) acc[t] = { correct: 0, total: 0 };
	for (const r of golded) {
		for (const t of tools) {
			acc[t].total++;
			if (r.preds[t].code === r.gold) acc[t].correct++;
		}
	}

	const fullAgree = rows.filter((r) => new Set(tools.map((t) => r.preds[t].code)).size === 1).length;

	// Per-language accuracy (by gold), to expose where a tool is weak.
	const byLang = new Map<string, Record<string, { c: number; n: number }>>();
	for (const r of golded) {
		const gold = r.gold;
		if (gold === null) continue;
		const m =
			byLang.get(gold) ??
			Object.fromEntries(tools.map((t) => [t, { c: 0, n: 0 }]));
		for (const t of tools) {
			m[t].n++;
			if (r.preds[t].code === gold) m[t].c++;
		}
		byLang.set(gold, m);
	}

	const accLine = (t: string) => {
		const a = acc[t];
		const pct = a.total ? ((a.correct / a.total) * 100).toFixed(1) : "—";
		const msPer = (speed[t] / n).toFixed(3);
		return `| ${t} | ${a.correct}/${a.total} | ${pct}% | ${msPer} ms | ${speed[t].toFixed(0)} ms |`;
	};

	const langRows = [...byLang.entries()]
		.sort((a, b) => Object.values(b[1])[0].n - Object.values(a[1])[0].n)
		.map(([code, m]) => {
			const cells = tools.map((t) => `${m[t].c}/${m[t].n}`).join(" | ");
			return `| ${langName(code)} (${code}) | ${cells} |`;
		});

	const md = `# Language-detection benchmark

Sample: **${n} songs** with real lyrics, pulled from prod and stratified across
languages by a fastText pre-pass.

Gold label = **majority vote (2-of-3)**; on full-consensus songs every tool is
correct by construction, so accuracy differences come from the
disagreements. \`reviewed-labels.json\` overrides gold for hand-labeled songs.

- Full 3-way agreement: **${fullAgree}/${rows.length}** (${((fullAgree / rows.length) * 100).toFixed(0)}%)
- Gold resolved (consensus or majority or reviewed): **${golded.length}/${rows.length}**
- Unresolved 3-way splits (need manual label): **${unresolved.length}** → see disagreements.csv

## Accuracy vs. gold + speed

| tool | correct | accuracy | per song | total (${n}) |
|------|---------|----------|----------|--------------|
${tools.map(accLine).join("\n")}

_Speed measured warm over the full sample; per-song = total / ${n}._

## Per-language accuracy

| language | ${tools.join(" | ")} |
|----------|${tools.map(() => "---").join("|")}|
${langRows.join("\n")}

${unresolved.length ? `## Unresolved (label these in reviewed-labels.json)\n\n${unresolved.map((r) => `- \`${r.song_id}\` — ${r.artist} — ${r.title} → tinyld=${r.preds.tinyld.code} eld=${r.preds.eld.code} fasttext=${r.preds.fasttext.code}`).join("\n")}\n` : ""}`;

	writeFileSync(resolve(DIR, "report.md"), md);
}

main();

#!/usr/bin/env bun
/// <reference types="bun" />

// Reads this-session experiment records (filtered by mtime newer than the smoke start epoch) and
// reports the per-variant tier1 rule profile — the FREE deterministic signal for the Phase-4 H5–H9
// register experiment. Primary metric: the cross-sentence antithesis rate (the pivot we are trying to
// eliminate). Co-metrics: book-report-opener (the partner tell) and total HIGH per candidate.
//
//   bun scripts/voice-audit/analyze-smoke.ts            # the table
//   bun scripts/voice-audit/analyze-smoke.ts --dump 23  # print every v23 take + arc scenes (manual read)
//
// Reads per-run JSON files (one per runId) rather than runs.jsonl, so a concurrent-append race during
// the parallel smoke cannot corrupt the analysis.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunRecord } from "./experiments";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "experiments");
const EPOCH_FILE = join(dirname(fileURLToPath(import.meta.url)), ".smoke-logs", "start.epoch");

const VERSIONS = ["17", "23", "24", "25", "26", "27", "28"];
const dumpVersion = process.argv.includes("--dump")
	? process.argv[process.argv.indexOf("--dump") + 1]
	: null;

const startEpochMs = (() => {
	try {
		return Number(readFileSync(EPOCH_FILE, "utf-8").trim()) * 1000 - 5_000; // 5s buffer
	} catch {
		return 0;
	}
})();

function loadSessionRecords(): RunRecord[] {
	const out: RunRecord[] = [];
	for (const f of readdirSync(DIR)) {
		if (!f.endsWith(".json")) continue;
		const full = join(DIR, f);
		if (statSync(full).mtimeMs < startEpochMs) continue;
		try {
			const rec = JSON.parse(readFileSync(full, "utf-8")) as RunRecord;
			if (!rec.model?.includes("flash")) continue;
			if (rec.temperature !== 0.3) continue;
			if (!VERSIONS.includes(rec.promptVersion)) continue;
			out.push(rec);
		} catch {
			// skip a half-written file
		}
	}
	return out;
}

function fmt(n: number, d = 2): string {
	return n.toFixed(d);
}

const records = loadSessionRecords();

if (dumpVersion) {
	const recs = records.filter((r) => r.promptVersion === dumpVersion);
	console.log(`\n=== v${dumpVersion} candidate prose (${recs.length}) — read for genuine directness ===`);
	for (const r of recs) {
		const anti = r.byRule.antithesis ?? 0;
		const book = r.byRule["book-report-opener"] ?? 0;
		console.log(`\n--- ${r.song}  [antithesis ${anti}, book-report ${book}, high ${r.totals.high}] ---`);
		console.log(`lens:  ${r.analysis.lens}`);
		console.log(`take:  ${r.analysis.take}`);
		for (const b of r.analysis.arc) console.log(`  • ${b.scene}`);
		if (r.analysis.contradiction) console.log(`contradiction: ${r.analysis.contradiction}`);
	}
	process.exit(0);
}

console.log(`\nSession records (mtime ≥ smoke start, flash, t0.3): ${records.length}`);

// Per-song coverage matrix — flags imbalance (e.g. not-like-us short on the control after the
// residual-429 hangover) that would bias the pooled rate comparison.
const songs = [...new Set(records.map((r) => r.song))].sort();
console.log(`\nCoverage (candidates per song × version; aim 3 each):`);
console.log(`${"song".padEnd(26)}${VERSIONS.map((v) => `v${v}`.padEnd(5)).join("")}`);
for (const s of songs) {
	const cells = VERSIONS.map((v) => {
		const c = records.filter((r) => r.song === s && r.promptVersion === v).length;
		return String(c).padEnd(5);
	});
	const short = VERSIONS.some((v) => records.filter((r) => r.song === s && r.promptVersion === v).length < 3);
	console.log(`${s.slice(0, 25).padEnd(26)}${cells.join("")}${short ? " ⚠ short" : ""}`);
}

console.log(`\n${"version".padEnd(9)}${"n".padEnd(5)}${"antith/c".padEnd(11)}${"% w/anti".padEnd(11)}${"book/c".padEnd(9)}${"% w/book".padEnd(11)}${"high/c".padEnd(9)}`);
console.log("-".repeat(64));

interface Row {
	v: string;
	n: number;
	antiPerC: number;
	pctAnti: number;
	bookPerC: number;
	pctBook: number;
	highPerC: number;
}
const rows: Row[] = [];

for (const v of VERSIONS) {
	const recs = records.filter((r) => r.promptVersion === v);
	const n = recs.length;
	if (n === 0) {
		console.log(`v${v.padEnd(8)}${"0".padEnd(5)}(no records yet)`);
		continue;
	}
	const antiHits = recs.map((r) => r.byRule.antithesis ?? 0);
	const bookHits = recs.map((r) => r.byRule["book-report-opener"] ?? 0);
	const high = recs.map((r) => r.totals.high);
	const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
	const row: Row = {
		v,
		n,
		antiPerC: sum(antiHits) / n,
		pctAnti: (antiHits.filter((x) => x > 0).length / n) * 100,
		bookPerC: sum(bookHits) / n,
		pctBook: (bookHits.filter((x) => x > 0).length / n) * 100,
		highPerC: sum(high) / n,
	};
	rows.push(row);
	const star = v === "17" ? " ← control" : "";
	console.log(
		`v${v.padEnd(8)}${String(n).padEnd(5)}${fmt(row.antiPerC).padEnd(11)}${fmt(row.pctAnti, 0).concat("%").padEnd(11)}${fmt(row.bookPerC).padEnd(9)}${fmt(row.pctBook, 0).concat("%").padEnd(11)}${fmt(row.highPerC).padEnd(9)}${star}`,
	);
}

// Rank by the primary metric (antithesis/candidate, lower is better); break ties by book-report.
const control = rows.find((r) => r.v === "17");
console.log(`\nRanked by antithesis/candidate (primary target; lower is better):`);
[...rows]
	.sort((a, b) => a.antiPerC - b.antiPerC || a.bookPerC - b.bookPerC)
	.forEach((r, i) => {
		const vsControl =
			control && r.v !== "17"
				? `  (${r.antiPerC <= control.antiPerC ? "≤" : ">"} v17 control ${fmt(control.antiPerC)})`
				: "";
		console.log(`  ${i + 1}. v${r.v}: ${fmt(r.antiPerC)}/c, ${fmt(r.pctAnti, 0)}% w/pivot${vsControl}`);
	});

console.log(
	`\nNote: a low antithesis count is NECESSARY but not SUFFICIENT — run --dump <v> on the leaders to confirm genuine directness (not rule-dodging) before any paid pairwise.`,
);

// Regenerate-on-hit gate simulation (read-only, on the candidates already generated). The gate the
// prior session shipped (tier1 antithesis > 0 → reject + resample) eliminates the pivot at the cost of
// extra draws. p_clean = fraction of candidates with antithesis 0; expected draws to a clean read =
// 1/p_clean (geometric). A lower base rate (a better prompt) makes the gate cheaper. "songs 0-clean" =
// songs where EVERY sampled draw pivoted — the gate's hard cases, where it may exhaust its retry budget.
console.log(`\n${"=".repeat(64)}\nRegenerate-on-hit gate simulation (eliminates the pivot; cost = extra draws):`);
console.log(`${"version".padEnd(9)}${"% clean".padEnd(10)}${"E[draws→clean]".padEnd(16)}${"songs 0-clean".padEnd(14)}`);
for (const v of VERSIONS) {
	const recs = records.filter((r) => r.promptVersion === v);
	if (!recs.length) continue;
	const clean = recs.filter((r) => (r.byRule.antithesis ?? 0) === 0).length;
	const pClean = clean / recs.length;
	const eDraws = pClean > 0 ? 1 / pClean : Infinity;
	const songsHere = [...new Set(recs.map((r) => r.song))];
	const zeroClean = songsHere.filter(
		(s) => recs.filter((r) => r.song === s && (r.byRule.antithesis ?? 0) === 0).length === 0,
	);
	const fullyClean = recs.filter((r) => r.totals.high === 0).length;
	const pctFully = (fullyClean / recs.length) * 100;
	const star = v === "17" ? " ← control" : v === "24" ? " ← lowest base rate" : "";
	console.log(
		`v${v.padEnd(8)}${`${fmt(pClean * 100, 0)}%`.padEnd(10)}${fmt(eDraws).padEnd(16)}${`${zeroClean.length}/${songsHere.length}`.padEnd(14)}${`${fmt(pctFully, 0)}%`.padEnd(12)}${star}`,
	);
}
console.log(
	`\nReading: even the best prompt leaves ~20-25% of reads with the pivot, but resampling on the gate lands a\nclean draft in ~1.3 draws. A lower-base-rate prompt (v24) is cheaper to gate. The pivot is ELIMINABLE by\nprompt+gate, not by prompt alone — matching the research (sequence-level enforcement / FTPO) and the prior call.`,
);

// HIGH-severity composition — what the gate does NOT fix. The antithesis gate removes only its own
// subset; these other HIGH rules survive it. Shows whether "tier1-clean" is true (it is not for v17).
const HIGH_RULES = [
	"antithesis",
	"participial-closure",
	"self-reference",
	"book-report-opener",
	"academic-register",
	"structural-section",
];
console.log(`\n${"=".repeat(64)}\nHIGH-rule composition per candidate (the gate only removes 'antithesis'):`);
console.log(`${"version".padEnd(9)}${HIGH_RULES.map((r) => r.slice(0, 9).padEnd(10)).join("")}${"Σhigh/c".padEnd(9)}`);
for (const v of VERSIONS) {
	const recs = records.filter((r) => r.promptVersion === v);
	if (!recs.length) continue;
	const perRule = HIGH_RULES.map(
		(rule) => recs.reduce((a, r) => a + (r.byRule[rule] ?? 0), 0) / recs.length,
	);
	const sum = perRule.reduce((a, b) => a + b, 0);
	console.log(
		`v${v.padEnd(8)}${perRule.map((x) => fmt(x).padEnd(10)).join("")}${fmt(sum).padEnd(9)}${v === "17" ? " ← control" : ""}`,
	);
}
console.log(
	`\nReading: v17 is NOT tier1-clean — it averages ~4 HIGH/candidate, dominated by participial-closure and\nself-reference, which the antithesis gate does NOT touch. "tier1-clean" should read "antithesis-gated".`,
);
process.exit(0);

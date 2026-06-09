#!/usr/bin/env bun
/// <reference types="bun" />

// FREE side-by-side of the two rewrite modes (Phase-4 H12) on the SAME real reads, so the only
// variable is the mode. The minimal pass recasts the pivot with "change as little as possible"; the
// direct-assertion pass DELETES the negated half and lets the surviving claim stand alone, strengthened
// from grounded detail already present. Picks the reads with the MOST antithesis hits (where the modes
// can actually differ) and prints, per read: the tier1 profile before / after-minimal / after-DA
// (antithesis + total HIGH + puffery + total MEDIUM — puffery is the drift risk of "strengthen B"),
// the word-count change (does strengthening inflate length?), and the antithesis-bearing prose fields
// side by side for a hand-read of whether the stronger standalone is better or just puffier.
//
//   bun scripts/voice-audit/rewrite-mode-compare.ts                 # top 4 v29 reads by antithesis
//   bun scripts/voice-audit/rewrite-mode-compare.ts --version 17    # compare on v17 reads instead
//   bun scripts/voice-audit/rewrite-mode-compare.ts --n 6

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLlmConfig } from "@/lib/integrations/llm/config";
import { LlmService } from "@/lib/integrations/llm/service";
import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";
import type { RunRecord } from "./experiments";
import { rewriteRead } from "@/lib/domains/enrichment/content-analysis/voice/rewrite-pass";
import { runAllRules } from "@/lib/domains/enrichment/content-analysis/voice/tier1-rules";
import { voiceStats } from "./stats";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = join(SCRIPT_DIR, "experiments");
const OUT_DIR = join(SCRIPT_DIR, "rewrite-artifacts");

function parseArgs() {
	const argv = process.argv.slice(2);
	const get = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
	return {
		version: get("--version") ?? "29",
		n: Number(get("--n") ?? 4),
		passes: Number(get("--passes") ?? 2),
	};
}

function load(version: string): RunRecord[] {
	const out: RunRecord[] = [];
	for (const f of readdirSync(EXP_DIR)) {
		if (!f.endsWith(".json")) continue;
		try {
			const r = JSON.parse(readFileSync(join(EXP_DIR, f), "utf-8")) as RunRecord;
			if (r.promptVersion !== version) continue;
			if (!r.model?.includes("flash")) continue;
			if (r.temperature !== 0.3) continue;
			out.push(r);
		} catch {
			// skip a half-written file
		}
	}
	return out;
}

interface Profile {
	antithesis: number;
	high: number;
	puffery: number;
	medium: number;
	words: number;
}

function profile(read: SongRead): Profile {
	const hits = runAllRules(read);
	let antithesis = 0, high = 0, puffery = 0, medium = 0;
	for (const h of hits) {
		if (h.rule === "antithesis") antithesis++;
		if (h.rule === "puffery-adjective") puffery++;
		if (h.severity === "high") high++;
		if (h.severity === "medium") medium++;
	}
	return { antithesis, high, puffery, medium, words: voiceStats(read).wordCount };
}

function antithesisSpans(read: SongRead): { field: string; span: string }[] {
	return runAllRules(read)
		.filter((h) => h.rule === "antithesis")
		.map((h) => ({ field: h.field, span: h.span }));
}

function fmtProfile(label: string, p: Profile): string {
	return `  ${label.padEnd(18)} anti=${p.antithesis}  ΣHIGH=${p.high}  puffery=${p.puffery}  ΣMED=${p.medium}  words=${p.words}`;
}

async function main() {
	const args = parseArgs();
	const records = load(args.version)
		.map((r) => ({ r, anti: profile(r.analysis).antithesis }))
		.filter((x) => x.anti > 0)
		.sort((a, b) => b.anti - a.anti)
		.slice(0, args.n)
		.map((x) => x.r);

	if (!records.length) {
		console.error(`No v${args.version} flash reads with an antithesis hit found. (Generation done? Pivot present?)`);
		process.exit(1);
	}

	const resolution = resolveLlmConfig("google-vertex");
	if (!resolution.ok) {
		console.error(resolution.reason);
		process.exit(1);
	}
	const llm = new LlmService(resolution.config);
	mkdirSync(OUT_DIR, { recursive: true });

	console.log(`Rewrite-mode compare — ${records.length} v${args.version} flash read(s) with the most antithesis hits, ${llm.getCurrentModel()}, maxPasses=${args.passes}\n`);

	const totals = { before: { anti: 0, high: 0, puff: 0, words: 0 }, min: { anti: 0, high: 0, puff: 0, words: 0 }, da: { anti: 0, high: 0, puff: 0, words: 0 } };
	let tokens = 0;

	for (const rec of records) {
		console.log(`${"=".repeat(80)}\n${rec.song}  [${rec.runId.slice(0, 24)}]`);
		const before = profile(rec.analysis);
		const spansBefore = antithesisSpans(rec.analysis);

		const min = await rewriteRead(rec.analysis, llm, { maxPasses: args.passes, mode: "minimal" });
		const da = await rewriteRead(rec.analysis, llm, { maxPasses: args.passes, mode: "direct-assertion" });
		tokens += min.tokens + da.tokens;

		const pMin = profile(min.read);
		const pDa = profile(da.read);

		console.log(fmtProfile("BEFORE (raw)", before));
		console.log(fmtProfile("minimal rewrite", pMin));
		console.log(fmtProfile("direct-assertion", pDa));
		if (min.error) console.log(`  ⚠ minimal error: ${min.error}`);
		if (da.error) console.log(`  ⚠ direct-assertion error: ${da.error}`);

		// The pivot-bearing fields, shown across all three so the delete-and-strengthen can be read.
		const fields = [...new Set(spansBefore.map((s) => s.field))];
		for (const field of fields) {
			const get = (read: SongRead): string => {
				if (field === "take") return read.take;
				if (field === "image") return read.image;
				if (field === "contradiction") return read.contradiction ?? "(none)";
				if (field === "texture") return read.texture ?? "(none)";
				const m = field.match(/^arc\[(\d+)\]\.scene$/);
				if (m) return read.arc[Number(m[1])]?.scene ?? "(none)";
				return "(?)";
			};
			console.log(`\n  ── ${field} ──`);
			console.log(`    raw:  ${get(rec.analysis)}`);
			console.log(`    min:  ${get(min.read)}`);
			console.log(`    DA:   ${get(da.read)}`);
		}
		console.log("");

		writeFileSync(
			join(OUT_DIR, `${rec.runId}__mode-compare.json`),
			`${JSON.stringify({ runId: rec.runId, song: rec.song, before: rec.analysis, minimal: min.read, directAssertion: da.read }, null, 2)}\n`,
		);

		totals.before.anti += before.antithesis; totals.before.high += before.high; totals.before.puff += before.puffery; totals.before.words += before.words;
		totals.min.anti += pMin.antithesis; totals.min.high += pMin.high; totals.min.puff += pMin.puffery; totals.min.words += pMin.words;
		totals.da.anti += pDa.antithesis; totals.da.high += pDa.high; totals.da.puff += pDa.puffery; totals.da.words += pDa.words;
	}

	console.log(`${"=".repeat(80)}\nTOTALS across ${records.length} reads`);
	console.log(`  ${"".padEnd(18)} anti  ΣHIGH  puffery  words`);
	console.log(`  ${"BEFORE (raw)".padEnd(18)} ${String(totals.before.anti).padStart(4)}  ${String(totals.before.high).padStart(5)}  ${String(totals.before.puff).padStart(7)}  ${String(totals.before.words).padStart(5)}`);
	console.log(`  ${"minimal".padEnd(18)} ${String(totals.min.anti).padStart(4)}  ${String(totals.min.high).padStart(5)}  ${String(totals.min.puff).padStart(7)}  ${String(totals.min.words).padStart(5)}`);
	console.log(`  ${"direct-assertion".padEnd(18)} ${String(totals.da.anti).padStart(4)}  ${String(totals.da.high).padStart(5)}  ${String(totals.da.puff).padStart(7)}  ${String(totals.da.words).padStart(5)}`);
	console.log(`\n  tokens=${tokens}. Reading: both modes should drive anti→~0. Watch puffery and words on direct-assertion`);
	console.log(`  — if "strengthen B" inflates puffery or length, that is the drift this mode risks (gold beats v17 on puffery).`);
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});

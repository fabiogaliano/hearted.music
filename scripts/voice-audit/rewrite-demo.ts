#!/usr/bin/env bun
/// <reference types="bun" />

// Demonstrates the post-generation rewrite pass (rewrite/rewrite-pass.ts) on REAL v17 Flash reads
// pulled from experiments/, and proves — for free, with the same tier1 rules — that it removes the
// HIGH-register tells (participial-closure, antithesis, self-reference, …) the prompt could not.
//
//   bun scripts/voice-audit/rewrite-demo.ts                 # auto-pick the 3 dirtiest v17 reads (1/song)
//   bun scripts/voice-audit/rewrite-demo.ts --n 5           # more reads
//   bun scripts/voice-audit/rewrite-demo.ts --runs <id>,<id># rewrite these exact run records
//   bun scripts/voice-audit/rewrite-demo.ts --passes 3      # raise the rewrite pass budget
//
// Writes each rewritten read to rewrite-artifacts/<runId>__rewritten.json for inspection / reuse.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLlmConfig } from "@/lib/integrations/llm/config";
import { LlmService } from "@/lib/integrations/llm/service";
import type { RunRecord } from "./experiments";
import { rewriteRead, TARGET_RULES } from "./rewrite/rewrite-pass";
import { runAllRules } from "./tier1/rules";
import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";
import type { RuleHit } from "./types";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = join(SCRIPT_DIR, "experiments");
const OUT_DIR = join(SCRIPT_DIR, "rewrite-artifacts");

const HIGH_RULES = [
	"antithesis",
	"participial-closure",
	"self-reference",
	"book-report-opener",
	"academic-register",
	"structural-section",
];

function parseArgs() {
	const argv = process.argv.slice(2);
	const get = (flag: string) =>
		argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined;
	return {
		n: Number(get("--n") ?? 3),
		passes: Number(get("--passes") ?? 2),
		runs: get("--runs")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null,
	};
}

function loadV17FlashRecords(): RunRecord[] {
	const out: RunRecord[] = [];
	for (const f of readdirSync(EXP_DIR)) {
		if (!f.endsWith(".json")) continue;
		try {
			const r = JSON.parse(readFileSync(join(EXP_DIR, f), "utf-8")) as RunRecord;
			if (r.promptVersion !== "17") continue;
			if (!r.model?.includes("flash")) continue;
			out.push(r);
		} catch {
			// skip a half-written file
		}
	}
	return out;
}

function targetCount(hits: RuleHit[]): number {
	return hits.filter((h) => TARGET_RULES.has(h.rule)).length;
}

// Picks the dirtiest read per song (most targeted HIGH hits), then the top n songs — so the demo
// spans different songs instead of stacking on one, and shows the pass on its hardest cases.
function pickRecords(records: RunRecord[], n: number): RunRecord[] {
	const bySong = new Map<string, RunRecord>();
	for (const r of records) {
		const score = targetCount(r.hits);
		const cur = bySong.get(r.song);
		if (!cur || score > targetCount(cur.hits)) bySong.set(r.song, r);
	}
	return [...bySong.values()]
		.sort((a, b) => targetCount(b.hits) - targetCount(a.hits))
		.slice(0, n);
}

function profile(read: SongRead): { byRule: Record<string, number>; high: number } {
	const hits = runAllRules(read);
	const byRule: Record<string, number> = {};
	let high = 0;
	for (const h of hits) {
		byRule[h.rule] = (byRule[h.rule] ?? 0) + 1;
		if (h.severity === "high") high++;
	}
	return { byRule, high };
}

function fmtProfileRow(label: string, p: ReturnType<typeof profile>): string {
	const cells = HIGH_RULES.map((r) => String(p.byRule[r] ?? 0).padStart(4));
	return `  ${label.padEnd(16)}${cells.join("")}   Σhigh=${p.high}`;
}

function printRead(read: SongRead): void {
	console.log(`    lens:  ${read.lens}`);
	console.log(`    take:  ${read.take}`);
	if (read.contradiction) console.log(`    contra: ${read.contradiction}`);
	read.arc.forEach((b, i) => console.log(`    arc${i + 1}: ${b.scene}`));
	if (read.texture) console.log(`    texture: ${read.texture}`);
}

async function main() {
	const args = parseArgs();
	const all = loadV17FlashRecords();
	const records = args.runs
		? all.filter((r) => args.runs?.includes(r.runId))
		: pickRecords(all, args.n);

	if (!records.length) {
		console.error("No matching v17 flash records found.");
		process.exit(1);
	}

	const resolution = resolveLlmConfig("google-vertex");
	if (!resolution.ok) {
		console.error(resolution.reason);
		process.exit(1);
	}
	const llm = new LlmService(resolution.config);

	mkdirSync(OUT_DIR, { recursive: true });
	console.log(
		`Rewrite-pass demo — ${records.length} real v17 flash read(s), ${llm.getCurrentModel()}, maxPasses=${args.passes}`,
	);
	console.log(
		`HIGH columns: ${HIGH_RULES.map((r) => r.slice(0, 4)).join(" ")}  (anti part self book acad/sect)\n`,
	);

	let totalTokens = 0;
	const summary: Array<{ song: string; before: number; after: number; targetBefore: number; targetAfter: number; passes: number }> = [];

	for (const rec of records) {
		console.log(`${"=".repeat(78)}\n${rec.song}  [${rec.runId}]`);
		const before = profile(rec.analysis);

		const result = await rewriteRead(rec.analysis, llm, { maxPasses: args.passes });
		totalTokens += result.tokens;
		const after = profile(result.read);

		console.log(fmtProfileRow("BEFORE (v17)", before));
		console.log(fmtProfileRow(`AFTER (+rw ×${result.passes})`, after));
		if (result.error) console.log(`  ⚠ rewrite error: ${result.error}`);

		const tBefore = targetCount(result.hitsBefore);
		const tAfter = targetCount(result.hitsAfter);
		console.log(
			`  targeted HIGH tells: ${tBefore} → ${tAfter}   (Σhigh ${before.high} → ${after.high})   tokens=${result.tokens}`,
		);

		console.log(`\n  --- BEFORE prose ---`);
		printRead(rec.analysis);
		console.log(`\n  --- AFTER prose ---`);
		printRead(result.read);
		console.log("");

		writeFileSync(
			join(OUT_DIR, `${rec.runId}__rewritten.json`),
			`${JSON.stringify({ runId: rec.runId, song: rec.song, before: rec.analysis, after: result.read, passes: result.passes, tokens: result.tokens }, null, 2)}\n`,
		);

		summary.push({
			song: rec.song,
			before: before.high,
			after: after.high,
			targetBefore: tBefore,
			targetAfter: tAfter,
			passes: result.passes,
		});
	}

	console.log(`${"=".repeat(78)}\nSUMMARY`);
	const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
	for (const s of summary) {
		console.log(
			`  ${s.song.padEnd(28)} targeted ${s.targetBefore}→${s.targetAfter}   Σhigh ${s.before}→${s.after}   (${s.passes} pass)`,
		);
	}
	console.log(
		`\n  TOTAL targeted HIGH tells: ${sum(summary.map((s) => s.targetBefore))} → ${sum(summary.map((s) => s.targetAfter))}` +
			`   |  TOTAL Σhigh: ${sum(summary.map((s) => s.before))} → ${sum(summary.map((s) => s.after))}   |  tokens=${totalTokens}`,
	);
	console.log(
		`\nNote: removal is measured FREE by re-running the tier1 rules on the rewritten read. Grounding/`,
	);
	console.log(
		`content fidelity is NOT auto-checked here — eyeball the BEFORE/AFTER prose above, or run a paid pairwise.`,
	);
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});

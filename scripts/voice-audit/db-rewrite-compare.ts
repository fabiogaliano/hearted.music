#!/usr/bin/env bun
/// <reference types="bun" />

// Measures the post-generation REWRITE PASS on the REAL prod population. Takes a sample of the actual
// stored v17 reads from the local DB (what prod literally shipped, ~5 HIGH tells/read), runs each
// through rewriteRead() (Flash, surgical recast of only the flagged AI-tell sentences; lens/tension/
// lyric lines pinned in code so content can't drift), and reports tier1 HIGH before → after, how many
// reads reach fully-clean, the per-rule reduction, and prose-length drift (a fidelity sanity check).
//
// This answers the step-4 question with honest numbers on real songs: "if we added a cleanup pass to
// prod, would it actually clean the reads that are out there, without gutting them?"
//
//   bun scripts/voice-audit/db-rewrite-compare.ts                 # 20 most-recent v17 reads
//   bun scripts/voice-audit/db-rewrite-compare.ts --n 30 --mode direct-assertion
//
// Flash-only, no Opus. No DB writes. Local DB only. (Grounding preservation beyond mechanical drift
// was established by the paid pairwise in doc-08 Rounds 3b/4; this run re-confirms the FREE part —
// tells removed — on the real population and checks length drift.)

import postgres from "postgres";
import { SongReadSchema, type SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";
import { resolveLlmConfig } from "@/lib/integrations/llm/config";
import { LlmService } from "@/lib/integrations/llm/service";
import { rewriteRead, type RewriteMode } from "@/lib/domains/enrichment/content-analysis/voice/rewrite-pass";

const argv = process.argv.slice(2);
const getFlag = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const N = Number(getFlag("--n") ?? 20);
const VERSION = getFlag("--version") ?? "17";
const MODE = (getFlag("--mode") ?? "minimal") as RewriteMode;

const HIGH_RULES = ["antithesis", "participial-closure", "self-reference", "book-report-opener", "academic-register", "structural-section"];

const highCount = (hits: { severity: string; rule: string }[]) => hits.filter((h) => h.severity === "high").length;
const byHighRule = (hits: { severity: string; rule: string }[]): Record<string, number> => {
	const out: Record<string, number> = {};
	for (const h of hits) if (h.severity === "high") out[h.rule] = (out[h.rule] ?? 0) + 1;
	return out;
};

// Total prose length across the fields the rewrite is allowed to touch — a cheap drift check. A
// faithful recast stays close; a gutted or ballooned read shows up here.
function proseLen(read: SongRead): number {
	return (
		read.image.length +
		read.take.length +
		(read.contradiction?.length ?? 0) +
		read.arc.reduce((a, b) => a + b.scene.length, 0) +
		(read.texture?.length ?? 0)
	);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const sql = postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres");

async function main() {
	const resolution = resolveLlmConfig("google-vertex");
	if (!resolution.ok) {
		console.error(resolution.reason);
		process.exit(1);
	}
	const llm = new LlmService(resolution.config);

	const rows = await sql<{ song_id: string; analysis: unknown }[]>`
		SELECT DISTINCT ON (song_id) song_id, analysis
		FROM song_analysis
		WHERE prompt_version = ${VERSION}
		ORDER BY song_id, created_at DESC
	`;

	console.log(`\n${rows.length} stored v${VERSION} reads; running the "${MODE}" rewrite pass over up to ${N} (Flash).\n`);

	const before: number[] = [];
	const after: number[] = [];
	const lenBefore: number[] = [];
	const lenAfter: number[] = [];
	const passesUsed: number[] = [];
	const ruleBefore: Record<string, number>[] = [];
	const ruleAfter: Record<string, number>[] = [];
	let cleanBefore = 0;
	let cleanAfter = 0;
	let totalTokens = 0;
	let errors = 0;
	let used = 0;

	for (const row of rows) {
		if (used >= N) break;
		const raw = { ...(row.analysis as Record<string, unknown>) };
		delete raw.audio_features;
		const parsed = SongReadSchema.safeParse(raw);
		if (!parsed.success) continue;
		used++;

		const res = await rewriteRead(parsed.data, llm, { mode: MODE });
		if (res.error) errors++;

		const hb = highCount(res.hitsBefore);
		const ha = highCount(res.hitsAfter);
		before.push(hb);
		after.push(ha);
		if (hb === 0) cleanBefore++;
		if (ha === 0) cleanAfter++;
		ruleBefore.push(byHighRule(res.hitsBefore));
		ruleAfter.push(byHighRule(res.hitsAfter));
		lenBefore.push(proseLen(parsed.data));
		lenAfter.push(proseLen(res.read));
		passesUsed.push(res.passes);
		totalTokens += res.tokens;

		console.log(`  ${row.song_id.slice(0, 8)}  HIGH ${String(hb).padStart(2)} → ${String(ha).padStart(2)}  (${res.passes} pass${res.passes === 1 ? "" : "es"})${res.error ? "  [LLM ERROR]" : ""}`);
	}

	const lenDriftPct = mean(lenBefore) ? ((mean(lenAfter) - mean(lenBefore)) / mean(lenBefore)) * 100 : 0;

	console.log(`\n=== SUMMARY (${used} real prod reads, v${VERSION}, "${MODE}" rewrite, Flash) ===`);
	console.log(`  HIGH tells/read:        ${mean(before).toFixed(2)} → ${mean(after).toFixed(2)}   (−${(mean(before) - mean(after)).toFixed(2)}, ${mean(before) ? (((mean(before) - mean(after)) / mean(before)) * 100).toFixed(0) : 0}% removed)`);
	console.log(`  reads fully HIGH-clean: ${cleanBefore}/${used} → ${cleanAfter}/${used}  (${((cleanAfter / used) * 100).toFixed(0)}% clean after)`);
	console.log(`  prose length drift:     ${lenDriftPct >= 0 ? "+" : ""}${lenDriftPct.toFixed(1)}%   (≈0 = faithful recast, no gutting/ballooning)`);
	console.log(`  passes used (avg):      ${mean(passesUsed).toFixed(2)} / 2 max`);
	console.log(`  rewrite tokens total:   ${totalTokens}  (≈ ${Math.round(totalTokens / used)}/read — the +1-call cost)`);
	if (errors) console.log(`  LLM errors:             ${errors}`);

	console.log(`\n  Per-HIGH-rule mean/read (before → after):`);
	for (const rule of HIGH_RULES) {
		const b = mean(ruleBefore.map((r) => r[rule] ?? 0));
		const a = mean(ruleAfter.map((r) => r[rule] ?? 0));
		if (b === 0 && a === 0) continue;
		console.log(`    ${rule.padEnd(20)} ${b.toFixed(2).padStart(5)} → ${a.toFixed(2).padStart(5)}`);
	}
	console.log();
}

try {
	await main();
} finally {
	await sql.end();
}

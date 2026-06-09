#!/usr/bin/env bun
/// <reference types="bun" />

// One-off: runs the tier1 voice rules over the REAL stored v17 reads in the local Supabase DB
// (song_analysis.analysis), not the gold-song harness — to answer empirically "does the live v17
// output carry the AI tells the prompt bans?" Reports the per-read HIGH/MEDIUM tell profile, the
// share of reads that are fully HIGH-clean, and the literal `contradiction`-field fill rate.
//
//   bun scripts/voice-audit/audit-db-reads.ts            # all v17 reads
//   bun scripts/voice-audit/audit-db-reads.ts --version 17 --dump 8   # also print 8 dirtiest reads' tells

import postgres from "postgres";
import { SongReadSchema } from "@/lib/domains/enrichment/content-analysis/read-schema";
import { runAllRules } from "@/lib/domains/enrichment/content-analysis/voice/tier1-rules";

const argv = process.argv.slice(2);
const get = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const version = get("--version") ?? "17";
const dumpN = Number(get("--dump") ?? 0);

const HIGH_RULES = ["antithesis", "participial-closure", "self-reference", "book-report-opener", "academic-register", "structural-section"];

const sql = postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres");

try {
	const rows = await sql<{ id: string; song_id: string; analysis: unknown; created_at: string }[]>`
		SELECT id, song_id, analysis, created_at
		FROM song_analysis
		WHERE prompt_version = ${version}
		ORDER BY created_at DESC
	`;

	let parsed = 0, unparsed = 0;
	let highTotal = 0, medTotal = 0, fullyClean = 0, withContradiction = 0;
	const perRule: Record<string, number> = {};
	const withRule: Record<string, number> = {};
	const scored: { id: string; high: number; byRule: Record<string, number> }[] = [];

	for (const r of rows) {
		// Stored jsonb carries an extra audio_features input key; strip it before the read schema.
		const raw = { ...(r.analysis as Record<string, unknown>) };
		delete raw.audio_features;
		const res = SongReadSchema.safeParse(raw);
		if (!res.success) { unparsed++; continue; }
		parsed++;
		const read = res.data;
		if (read.contradiction !== null) withContradiction++;

		const hits = runAllRules(read);
		const byRule: Record<string, number> = {};
		let high = 0, med = 0;
		for (const h of hits) {
			perRule[h.rule] = (perRule[h.rule] ?? 0) + 1;
			byRule[h.rule] = (byRule[h.rule] ?? 0) + 1;
			if (h.severity === "high") high++;
			if (h.severity === "medium") med++;
		}
		for (const rule of Object.keys(byRule)) withRule[rule] = (withRule[rule] ?? 0) + 1;
		highTotal += high; medTotal += med;
		if (high === 0) fullyClean++;
		scored.push({ id: r.id, high, byRule });
	}

	const f = (n: number, d = 2) => n.toFixed(d);
	console.log(`\nReal stored v${version} reads in local DB: ${rows.length} (parsed ${parsed}, unparseable ${unparsed})\n`);
	console.log(`  HIGH tells / read:        ${f(highTotal / parsed)}   (total ${highTotal})`);
	console.log(`  MEDIUM tells / read:      ${f(medTotal / parsed)}   (total ${medTotal})`);
	console.log(`  reads fully HIGH-clean:   ${fullyClean}/${parsed}  (${f((fullyClean / parsed) * 100, 0)}%)`);
	console.log(`  reads with a contradiction field (non-null): ${withContradiction}/${parsed}  (${f((withContradiction / parsed) * 100, 0)}%)\n`);

	console.log(`  Per-HIGH-rule (avg/read · % of reads with ≥1):`);
	for (const rule of HIGH_RULES) {
		console.log(`    ${rule.padEnd(20)} ${f((perRule[rule] ?? 0) / parsed).padStart(5)}/read   ${f(((withRule[rule] ?? 0) / parsed) * 100, 0).padStart(3)}%`);
	}
	const otherRules = Object.keys(perRule).filter((r) => !HIGH_RULES.includes(r)).sort((a, b) => (perRule[b] ?? 0) - (perRule[a] ?? 0));
	if (otherRules.length) {
		console.log(`\n  Other (MED/LOW) rules (avg/read · % of reads):`);
		for (const rule of otherRules) {
			console.log(`    ${rule.padEnd(20)} ${f((perRule[rule] ?? 0) / parsed).padStart(5)}/read   ${f(((withRule[rule] ?? 0) / parsed) * 100, 0).padStart(3)}%`);
		}
	}

	if (dumpN > 0) {
		console.log(`\n  ${dumpN} dirtiest reads (by HIGH count):`);
		for (const s of scored.sort((a, b) => b.high - a.high).slice(0, dumpN)) {
			const tells = Object.entries(s.byRule).map(([r, n]) => `${r}×${n}`).join(", ");
			console.log(`    high=${s.high}  ${s.id.slice(0, 8)}  [${tells}]`);
		}
	}
} finally {
	await sql.end();
}

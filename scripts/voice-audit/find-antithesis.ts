#!/usr/bin/env bun
/// <reference types="bun" />

// One-off: finds stored reads in the local Supabase DB (song_analysis.analysis) that still carry
// the ANTITHESIS tell — the "X is not Y, it is Z" / "isn't X; it's Y" / "no X, no Y, just Z" pivot
// the cleanup pass targets. Runs the REAL tier1 antithesis rule (not an approximation), joins the
// song for a readable label, and prints each flagged span. Grouped by prompt_version so you can see
// whether newer reads carry fewer. Also surfaces the new cleanup_* columns when populated.
//
//   bun scripts/voice-audit/find-antithesis.ts

import postgres from "postgres";
import { SongReadSchema } from "@/lib/domains/enrichment/content-analysis/read-schema";
import { runAllRules } from "@/lib/domains/enrichment/content-analysis/voice/tier1-rules";

const sql = postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres");

interface Row {
	id: string;
	song_id: string;
	analysis: unknown;
	prompt_version: string | null;
	created_at: string;
	cleanup_passes: number | null;
	cleanup_tells_after: number | null;
	name: string | null;
	artists: string[] | null;
}

try {
	// Latest read per song (DISTINCT ON) — mirrors how get()/the app read analyses (latest wins),
	// so a re-cleaned row supersedes its dirty predecessor instead of both being counted.
	const rows = await sql<Row[]>`
		SELECT DISTINCT ON (sa.song_id)
		       sa.id, sa.song_id, sa.analysis, sa.prompt_version, sa.created_at,
		       sa.cleanup_passes, sa.cleanup_tells_after,
		       s.name, s.artists
		FROM song_analysis sa
		LEFT JOIN song s ON s.id = sa.song_id
		ORDER BY sa.song_id, sa.created_at DESC
	`;

	let parsed = 0;
	let unparsed = 0;
	const byVersion = new Map<string, { total: number; hit: number }>();
	const offenders: {
		label: string;
		version: string;
		cleaned: string;
		spans: { field: string; span: string }[];
	}[] = [];

	for (const r of rows) {
		const version = r.prompt_version ?? "(none)";
		const bucket = byVersion.get(version) ?? { total: 0, hit: 0 };
		bucket.total++;
		byVersion.set(version, bucket);

		// Stored jsonb carries an extra audio_features input key; strip it before the read schema.
		const raw = { ...(r.analysis as Record<string, unknown>) };
		delete raw.audio_features;
		const res = SongReadSchema.safeParse(raw);
		if (!res.success) {
			unparsed++;
			continue;
		}
		parsed++;

		const anti = runAllRules(res.data).filter((h) => h.rule === "antithesis");
		if (anti.length === 0) continue;

		bucket.hit++;
		const artist = r.artists?.[0] ?? "Unknown";
		// cleanup_passes is null for rows written before the cleanup-tracking migration.
		const cleaned =
			r.cleanup_passes == null
				? "pre-tracking"
				: `passes=${r.cleanup_passes}, residual=${r.cleanup_tells_after}`;
		offenders.push({
			label: `${artist} — ${r.name ?? "Unknown"}`,
			version,
			cleaned,
			spans: anti.map((h) => ({ field: h.field, span: h.span })),
		});
	}

	console.log(`\nStored reads: ${rows.length} (parsed ${parsed}, unparsed ${unparsed})`);
	console.log(`Reads carrying an antithesis pivot: ${offenders.length}/${parsed}\n`);

	console.log("By prompt_version:");
	for (const [version, b] of [...byVersion].sort()) {
		const pct = b.total ? ((b.hit / b.total) * 100).toFixed(0) : "0";
		console.log(`  v${version}: ${b.hit}/${b.total} reads (${pct}%)`);
	}

	if (offenders.length > 0) {
		console.log("\nOffending reads:\n");
		for (const o of offenders) {
			console.log(`• ${o.label}  [v${o.version}, ${o.cleaned}]`);
			for (const s of o.spans) {
				console.log(`    ${s.field}: "${s.span}"`);
			}
		}
	}
	console.log("");
} finally {
	await sql.end();
}

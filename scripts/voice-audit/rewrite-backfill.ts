#!/usr/bin/env bun
/// <reference types="bun" />

// Backfills the post-generation voice rewrite onto stored reads that still carry an ANTITHESIS pivot.
// Unlike db-rewrite-compare.ts (measure-only, no writes), this PERSISTS: it runs the production
// rewriteRead() over each flagged read and writes the cleaned result back through the production
// insert() service — so it goes through the exact prod write path and populates the new cleanup_*
// columns. Append-only (matches the table's "re-runs allowed" design): the original row is preserved
// and the cleaned row wins on read (latest-by-created_at). Reversible by deleting the new rows.
//
//   bun scripts/voice-audit/rewrite-backfill.ts             # dry run: show what WOULD change, no writes
//   bun scripts/voice-audit/rewrite-backfill.ts --write     # persist the cleaned reads
//
// Writes go to whatever SUPABASE_URL resolves to — verified LOCAL (127.0.0.1) before running.
// Flash, prod rewrite defaults (minimal mode, 2 passes, t0.2). Selection = latest v17 read per song
// that has >=1 antithesis hit; the rewrite then clears every targeted HIGH tell in that read, not
// just antithesis.

import { Result } from "better-result";
import postgres from "postgres";
import { env } from "@/env";
import { upsert as upsertSongAnalysis } from "@/lib/domains/enrichment/content-analysis/queries";
import {
	SongReadSchema,
	type SongRead,
} from "@/lib/domains/enrichment/content-analysis/read-schema";
import {
	rewriteRead,
	TARGET_RULES,
} from "@/lib/domains/enrichment/content-analysis/voice/rewrite-pass";
import { runAllRules } from "@/lib/domains/enrichment/content-analysis/voice/tier1-rules";
import { resolveLlmConfig } from "@/lib/integrations/llm/config";
import { LlmService } from "@/lib/integrations/llm/service";

const WRITE = process.argv.includes("--write");
const VERSION = "17";

const sql = postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres");

const antithesisCount = (read: SongRead) =>
	runAllRules(read).filter((h) => h.rule === "antithesis").length;
const highCount = (read: SongRead) =>
	runAllRules(read).filter((h) => h.severity === "high").length;

interface Row {
	song_id: string;
	analysis: unknown;
	model: string;
	prompt_version: string | null;
	name: string | null;
	artists: string[] | null;
}

async function main() {
	// Refuse to run against anything but a local Supabase, since this writes through the prod service.
	if (!env.SUPABASE_URL.includes("127.0.0.1") && !env.SUPABASE_URL.includes("localhost")) {
		console.error(`Refusing to run: SUPABASE_URL is not local (${env.SUPABASE_URL}).`);
		process.exit(1);
	}

	const resolution = resolveLlmConfig("google-vertex");
	if (!resolution.ok) {
		console.error(resolution.reason);
		process.exit(1);
	}
	const llm = new LlmService(resolution.config);

	const rows = await sql<Row[]>`
		SELECT DISTINCT ON (sa.song_id)
		       sa.song_id, sa.analysis, sa.model, sa.prompt_version, s.name, s.artists
		FROM song_analysis sa
		LEFT JOIN song s ON s.id = sa.song_id
		WHERE sa.prompt_version = ${VERSION}
		ORDER BY sa.song_id, sa.created_at DESC
	`;

	// Select the latest read per song that still carries an antithesis pivot.
	const targets: { row: Row; read: SongRead; storedBlob: Record<string, unknown> }[] = [];
	for (const row of rows) {
		const storedBlob = { ...(row.analysis as Record<string, unknown>) };
		const raw = { ...storedBlob };
		delete raw.audio_features;
		const parsed = SongReadSchema.safeParse(raw);
		if (!parsed.success) continue;
		if (antithesisCount(parsed.data) > 0) {
			targets.push({ row, read: parsed.data, storedBlob });
		}
	}

	console.log(
		`\n${rows.length} songs with a stored v${VERSION} read; ${targets.length} carry an antithesis pivot.`,
	);
	console.log(WRITE ? "Mode: WRITE (persisting cleaned reads)\n" : "Mode: DRY RUN (no writes)\n");

	let wrote = 0;
	let unchanged = 0;
	let failed = 0;

	for (const { row, read, storedBlob } of targets) {
		const label = `${row.artists?.[0] ?? "Unknown"} — ${row.name ?? "Unknown"}`;
		const antiBefore = antithesisCount(read);
		const highBefore = highCount(read);

		const res = await rewriteRead(read, llm); // prod defaults: minimal, 2 passes, t0.2

		const antiAfter = antithesisCount(res.read);
		const highAfter = highCount(res.read);
		const changed = JSON.stringify(res.read) !== JSON.stringify(read);

		const status = res.error
			? "LLM ERROR"
			: !changed
				? "no change"
				: WRITE
					? "written"
					: "would write";

		console.log(
			`• ${label}\n` +
				`    antithesis ${antiBefore} → ${antiAfter}   HIGH ${highBefore} → ${highAfter}   ` +
				`(${res.passes} pass${res.passes === 1 ? "" : "es"})   [${status}]`,
		);

		if (res.error) {
			failed++;
			console.log(`    error: ${res.error}`);
			continue;
		}
		if (!changed) {
			unchanged++;
			continue;
		}

		if (WRITE) {
			// Preserve the stored audio_features sub-object; only the read prose changes.
			const cleanedBlob = { ...storedBlob, ...res.read };
			const stored = await upsertSongAnalysis({
				song_id: row.song_id,
				analysis: cleanedBlob as never,
				model: row.model,
				prompt_version: row.prompt_version,
				tokens_used: res.tokens,
				cost_cents: null,
				cleanup_passes: res.passes,
				cleanup_tells_before: res.hitsBefore.filter((h) => TARGET_RULES.has(h.rule)).length,
				cleanup_tells_after: res.hitsAfter.filter((h) => TARGET_RULES.has(h.rule)).length,
				cleanup_error: res.error ?? null,
			});
			if (Result.isError(stored)) {
				failed++;
				console.log(`    DB insert failed: ${stored.error.message}`);
				continue;
			}
			wrote++;
		}
	}

	console.log(
		`\n=== ${WRITE ? "WROTE" : "DRY RUN"} ===\n` +
			`  targets: ${targets.length}\n` +
			`  ${WRITE ? "written" : "would write"}: ${WRITE ? wrote : targets.length - unchanged - failed}\n` +
			`  unchanged (rewrite no-op): ${unchanged}\n` +
			`  failed: ${failed}`,
	);
	if (!WRITE && targets.length > 0) {
		console.log(`\n  Re-run with --write to persist.`);
	}
	console.log();
}

try {
	await main();
} finally {
	await sql.end();
}

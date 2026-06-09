#!/usr/bin/env bun
/// <reference types="bun" />

// Measures the {example} few-shot lever on the REAL prod song population, not the clean gold-harness
// set. Samples N songs that already have a stored v17 read in the local DB (these stored reads are
// prod's own output — generated with EMPTY {example}/{annotations}, i.e. today's prod), then for each
// song re-generates the read TWO ways at prod settings (Flash, t0.3, 8k out):
//   - WITHOUT: empty {example}/{annotations}  → reproduces today's prod
//   - WITH:    the fixed prod pair (Not Like Us + Pink Pony Club) in {example}, empty {annotations}
//              → the planned-prod injection (06-block1-implementation-plan.md WP1 "Locked decisions")
// Everything else (lyrics, audio features, genres) is held identical between arms, so the tier1 HIGH
// delta is the pure few-shot lever on the population that actually scores 5.28 HIGH/read.
//
// It also prints each song's STORED prod read tier1 as a reference (n=1, the literal live output).
//
//   bun scripts/voice-audit/db-lever-compare.ts                 # 10 songs, n=3 each arm
//   bun scripts/voice-audit/db-lever-compare.ts --n 8 --runs 3
//
// Flash-only, no Opus. No DB writes. Local DB only.

import { Result } from "better-result";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { getLyricalPrompt } from "@/lib/domains/enrichment/content-analysis/prompts/registry";
import { SongReadSchema } from "@/lib/domains/enrichment/content-analysis/read-schema";
import { resolveLlmConfig } from "@/lib/integrations/llm/config";
import { LlmService } from "@/lib/integrations/llm/service";
import { DataFetcher } from "../prompt-lab/data-fetcher";
import { loadGoldExemplars, renderExemplarBlock } from "./exemplars";
import { tallyHits } from "./experiments";
import { runAllRules } from "@/lib/domains/enrichment/content-analysis/voice/tier1-rules";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const getFlag = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const N = Number(getFlag("--n") ?? 10);
const RUNS = Number(getFlag("--runs") ?? 3);
const VERSION = getFlag("--version") ?? "17";
const TEMP = Number(getFlag("--temp") ?? 0.3);

// The fixed prod pair, in the locked order. Built directly (not leave-one-out) because prod ships a
// fixed pair to every song; these target songs are the live population, never the golds themselves.
function buildFixedProdExampleBlock(): string {
	const byKey = new Map([...loadGoldExemplars().values()].map((g) => [g.key, g]));
	const nlu = byKey.get("not-like-us");
	const ppc = byKey.get("pink-pony-club");
	if (!nlu || !ppc) throw new Error("missing not-like-us / pink-pony-club gold exemplars");
	return renderExemplarBlock([nlu, ppc]);
}

function fillTemplate(
	template: string,
	artist: string,
	title: string,
	genres: string,
	audioFeatures: string,
	lyrics: string,
	exampleText: string,
	annotations: string,
): string {
	// Function replacers: gold prose / lyrics can contain "$", a special replacement pattern otherwise.
	return template
		.replace("{artist}", () => artist)
		.replace("{title}", () => title)
		.replace("{genres}", () => genres)
		.replace("{audio_features}", () => audioFeatures)
		.replace("{lyrics}", () => lyrics)
		.replace("{example}", () => exampleText)
		.replace("{annotations}", () => annotations);
}

interface DbSong {
	song_id: string;
	name: string;
	artists: string[];
	genres: string[];
	spotify_id: string;
	album_name: string | null;
	analysis: unknown;
}

function tier1High(read: unknown): { high: number; byRule: Record<string, number> } | null {
	const parsed = SongReadSchema.safeParse(read);
	if (!parsed.success) return null;
	const hits = runAllRules(parsed.data);
	const { totals, byRule } = tallyHits(hits);
	return { high: totals.high, byRule };
}

function mean(xs: number[]): number {
	return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

const HIGH_RULES = ["antithesis", "participial-closure", "self-reference", "book-report-opener", "academic-register", "structural-section"];

const sql = postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres");

async function main() {
	const resolution = resolveLlmConfig("google-vertex");
	if (!resolution.ok) {
		console.error(resolution.reason);
		process.exit(1);
	}
	const llm = new LlmService(resolution.config);
	const template = getLyricalPrompt(VERSION).template;
	const exampleBlock = buildFixedProdExampleBlock();
	const fetcher = new DataFetcher({
		cacheDir: join(SCRIPT_DIR, "../prompt-lab/.cache"),
		useCache: true,
	});

	// One stored read per song (the most recent), deterministic order, sampled across the population.
	const rows = await sql<DbSong[]>`
		SELECT DISTINCT ON (sa.song_id)
			sa.song_id, s.name, s.artists, s.genres, s.spotify_id, s.album_name, sa.analysis
		FROM song_analysis sa
		JOIN song s ON s.id = sa.song_id
		WHERE sa.prompt_version = ${VERSION}
		ORDER BY sa.song_id, sa.created_at DESC
	`;

	console.log(`\n${rows.length} songs with a stored v${VERSION} read; sampling up to ${N} with resolvable lyrics.\n`);
	console.log(`Arms: WITHOUT (empty slots = today's prod) vs WITH (fixed pair NLU+PPC = planned prod). Flash t${TEMP}, n=${RUNS}.\n`);

	const perSong: {
		label: string;
		storedHigh: number | null;
		without: number[];
		withInj: number[];
		withoutByRule: Record<string, number>[];
		withByRule: Record<string, number>[];
	}[] = [];

	let used = 0;
	for (const row of rows) {
		if (used >= N) break;
		const artist = row.artists[0] ?? "Unknown";
		const label = `${artist} — ${row.name}`;
		const data = await fetcher.fetchSongData({
			artist,
			title: row.name,
			spotifyTrackId: row.spotify_id,
			album: row.album_name ?? undefined,
		});
		if (!data.lyrics) {
			console.log(`  skip (no lyrics): ${label}`);
			continue;
		}
		used++;

		const genres = row.genres.length ? row.genres.join(", ") : "Unknown";
		const promptWithout = fillTemplate(template, artist, row.name, genres, data.audioFeaturesFormatted, data.lyrics, "", "");
		const promptWith = fillTemplate(template, artist, row.name, genres, data.audioFeaturesFormatted, data.lyrics, exampleBlock, "");

		const stored = tier1High(typeof row.analysis === "object" && row.analysis
			? (() => { const r = { ...(row.analysis as Record<string, unknown>) }; delete r.audio_features; return r; })()
			: row.analysis);

		const without: number[] = [];
		const withInj: number[] = [];
		const withoutByRule: Record<string, number>[] = [];
		const withByRule: Record<string, number>[] = [];
		for (let i = 0; i < RUNS; i++) {
			const a = await llm.generateObject(promptWithout, SongReadSchema, { maxOutputTokens: 8000, temperature: TEMP });
			if (Result.isOk(a)) {
				const t = tier1High(a.value.output);
				if (t) {
					without.push(t.high);
					withoutByRule.push(t.byRule);
				}
			}
			const b = await llm.generateObject(promptWith, SongReadSchema, { maxOutputTokens: 8000, temperature: TEMP });
			if (Result.isOk(b)) {
				const t = tier1High(b.value.output);
				if (t) {
					withInj.push(t.high);
					withByRule.push(t.byRule);
				}
			}
		}

		perSong.push({ label, storedHigh: stored?.high ?? null, without, withInj, withoutByRule, withByRule });
		console.log(
			`  ${label.slice(0, 44).padEnd(44)}  stored ${String(stored?.high ?? "?").padStart(2)}  ` +
				`WITHOUT [${without.join(",")}] μ${mean(without).toFixed(1)}  WITH [${withInj.join(",")}] μ${mean(withInj).toFixed(1)}`,
		);
	}

	const allStored = perSong.map((p) => p.storedHigh).filter((x): x is number => x !== null);
	const allWithout = perSong.flatMap((p) => p.without);
	const allWith = perSong.flatMap((p) => p.withInj);

	console.log(`\n=== SUMMARY (${perSong.length} songs, n=${RUNS}/arm, v${VERSION}, Flash t${TEMP}) ===`);
	console.log(`  stored prod reads (n=1/song):    μ ${mean(allStored).toFixed(2)} HIGH/read   (the literal live output)`);
	console.log(`  re-gen WITHOUT examples:         μ ${mean(allWithout).toFixed(2)} HIGH/read   (reproduces today's prod)`);
	console.log(`  re-gen WITH fixed-pair examples: μ ${mean(allWith).toFixed(2)} HIGH/read   (planned prod)`);
	const delta = mean(allWithout) - mean(allWith);
	const pct = mean(allWithout) ? (delta / mean(allWithout)) * 100 : 0;
	console.log(`  → lever: ${delta >= 0 ? "−" : "+"}${Math.abs(delta).toFixed(2)} HIGH/read (${pct.toFixed(0)}% ${delta >= 0 ? "fewer" : "more"} with examples)\n`);

	console.log(`  Per-HIGH-rule mean/read (WITHOUT → WITH):`);
	for (const rule of HIGH_RULES) {
		const wo = mean(perSong.flatMap((p) => p.withoutByRule.map((b) => b[rule] ?? 0)));
		const wi = mean(perSong.flatMap((p) => p.withByRule.map((b) => b[rule] ?? 0)));
		if (wo === 0 && wi === 0) continue;
		console.log(`    ${rule.padEnd(20)} ${wo.toFixed(2).padStart(5)} → ${wi.toFixed(2).padStart(5)}`);
	}
	console.log();
}

try {
	await main();
} finally {
	await sql.end();
}

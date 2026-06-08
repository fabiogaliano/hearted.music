#!/usr/bin/env bun
/// <reference types="bun" />

// The ship check for the Session-6 prod cutover decision: current prod (v13, legacy 8-field) vs the
// converged candidate (v17) vs v17 + the post-generation rewrite pass. For each song it generates
// v13 and v17 fresh (same lyrics/annotations), runs the rewrite pass on v17, then scores all three
// on the SAME tier1 surface and prints the prose side-by-side for a human read.
//
// v13 emits the legacy SongAnalysisLyrical shape, which the tier1 rules can't grade directly, so it
// is adapted onto the SongRead fields the rules read — interpretation→take, journey→arc scene,
// sonic_texture→texture — the three substantive prose fields both schemas share. v13's short
// headline/mood_description have no SongRead analog and are EXCLUDED from the numeric score (shown
// in the prose dump). So the numbers compare like-for-like; the character/grounding gap that tier1
// cannot see is left to the prose read (and a deferred paid pairwise).
//
//   bun scripts/voice-audit/ship-check.ts                 # default 3 golds
//   bun scripts/voice-audit/ship-check.ts --songs not-like-us,drivers-license

import { Result } from "better-result";
import type { z } from "zod";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	SongReadSchema,
	type SongRead,
} from "@/lib/domains/enrichment/content-analysis/read-schema";
import { renderAnnotationsBlockForPrompt } from "@/lib/domains/enrichment/content-analysis/grounding-annotations";
import { getLyricalPrompt } from "@/lib/domains/enrichment/content-analysis/prompts/registry";
import {
	SongAnalysisLyricalSchema,
	type SongAnalysisLyrical,
} from "@/lib/domains/enrichment/content-analysis/song-analysis";
import { resolveLlmConfig } from "@/lib/integrations/llm/config";
import { LlmService } from "@/lib/integrations/llm/service";
import { DataFetcher } from "../prompt-lab/data-fetcher";
import type { TestSong } from "../prompt-lab/test-songs";
import {
	loadGoldExemplars,
	renderExemplarBlock,
	type GoldExemplar,
} from "./exemplars";
import { EXAMPLE_COUNT, EXEMPLAR_POOL_KEYS } from "./regen";
import { rewriteRead, TARGET_RULES } from "./rewrite/rewrite-pass";
import { loadGroundingContext } from "./lyrics-context";
import { runAllRules } from "./tier1/rules";
import type { RuleHit } from "./types";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LYRICS_DIR = join(SCRIPT_DIR, "exemplars", "lyrics");
const OUT_DIR = join(SCRIPT_DIR, "ship-check-artifacts");

interface ShipSong extends TestSong {
	key: string;
	fallbackGenres?: string[];
}

// Copied from regen.ts SONGS (not exported there). Only the golds the ship check defaults to + a few
// extra so --songs can pick by key.
const SONGS: ShipSong[] = [
	{ key: "not-like-us", artist: "Kendrick Lamar", title: "Not Like Us", spotifyTrackId: "6AI3ezQ4o3HUoP6Dhudph3", album: "Not Like Us", fallbackGenres: ["trap", "hip hop"] },
	{ key: "drivers-license", artist: "Olivia Rodrigo", title: "drivers license", spotifyTrackId: "4ml4WlnHDEpOK8HRVYTCWf", album: "SOUR" },
	{ key: "blinding-lights", artist: "The Weeknd", title: "Blinding Lights", spotifyTrackId: "0VjIjW4GlUZAMYd2vXMi3b", album: "After Hours" },
	{ key: "as-it-was", artist: "Harry Styles", title: "As It Was", spotifyTrackId: "as-it-was", album: "Harry's House", fallbackGenres: ["pop", "synth-pop"] },
	{ key: "no-sex-for-ben", artist: "The Rapture", title: "No Sex for Ben", spotifyTrackId: "no-sex-for-ben", album: "Pieces of the People We Love", fallbackGenres: ["dance-punk", "indie rock"] },
	{ key: "beautiful-things", artist: "Benson Boone", title: "Beautiful Things", spotifyTrackId: "beautiful-things", album: "Fireworks & Rollerblades", fallbackGenres: ["pop"] },
];

const DEFAULT_KEYS = ["not-like-us", "drivers-license", "as-it-was"];
const HIGH_RULES = ["antithesis", "participial-closure", "self-reference", "book-report-opener", "academic-register", "structural-section"];

function selectExemplars(currentKey: string, byKey: Map<string, GoldExemplar>): GoldExemplar[] {
	const out: GoldExemplar[] = [];
	for (const key of EXEMPLAR_POOL_KEYS) {
		if (out.length >= EXAMPLE_COUNT) break;
		if (key === currentKey) continue;
		const gold = byKey.get(key);
		if (gold) out.push(gold);
	}
	return out;
}

function annotationsForKey(key: string): string {
	if (!existsSync(join(LYRICS_DIR, `${key}.json`))) return "";
	return renderAnnotationsBlockForPrompt(loadGroundingContext(key).annotationsBlock);
}

// Maps the legacy v13 shape onto the SongRead fields the tier1 rules read. Only the three shared
// substantive prose fields are populated; the rest are inert (lens/tension excluded from prose(),
// image/contradiction empty/null) so v13 is scored on exactly the prose v17 is scored on.
function adaptLegacy(a: SongAnalysisLyrical): SongRead {
	return {
		lens: "",
		tension: a.compound_mood,
		image: "",
		take: a.interpretation,
		contradiction: null,
		arc: a.journey.map((j) => ({ label: j.section, mood: j.mood, scene: j.description })),
		lines: a.key_lines.map((k) => ({ line: k.line })),
		texture: a.sonic_texture || null,
	};
}

function fillTemplate(
	template: string,
	song: ShipSong,
	genres: string[],
	audioFeatures: string,
	lyrics: string,
	exampleText: string,
	annotations: string,
): string {
	return template
		.replace("{artist}", () => song.artist)
		.replace("{title}", () => song.title)
		.replace("{genres}", () => (genres.length ? genres.join(", ") : "Unknown"))
		.replace("{audio_features}", () => audioFeatures)
		.replace("{lyrics}", () => lyrics)
		.replace("{example}", () => exampleText)
		.replace("{annotations}", () => annotations);
}

function profile(read: SongRead): { byRule: Record<string, number>; high: number; hits: RuleHit[] } {
	const hits = runAllRules(read);
	const byRule: Record<string, number> = {};
	let high = 0;
	for (const h of hits) {
		byRule[h.rule] = (byRule[h.rule] ?? 0) + 1;
		if (h.severity === "high") high++;
	}
	return { byRule, high, hits };
}

function row(label: string, p: ReturnType<typeof profile>): string {
	const cells = HIGH_RULES.map((r) => String(p.byRule[r] ?? 0).padStart(4));
	const target = p.hits.filter((h) => TARGET_RULES.has(h.rule)).length;
	return `  ${label.padEnd(18)}${cells.join("")}   Σhigh=${String(p.high).padStart(2)}  targeted=${target}`;
}

// Flash intermittently returns "No object generated: could not parse the response" — a non-retryable
// provider error LlmService won't retry, but a fresh draw usually succeeds. Retry it a few times here
// so one flaky draw doesn't drop a song from the comparison.
async function genWithRetry<T>(
	llm: LlmService,
	prompt: string,
	schema: z.ZodType<T>,
	attempts = 3,
) {
	let last = await llm.generateObject(prompt, schema, { temperature: 0.3 });
	for (let i = 1; i < attempts && Result.isError(last); i++) {
		last = await llm.generateObject(prompt, schema, { temperature: 0.3 });
	}
	return last;
}

async function main() {
	const argv = process.argv.slice(2);
	const songsArg = argv.includes("--songs") ? argv[argv.indexOf("--songs") + 1] : null;
	const keys = songsArg ? songsArg.split(",").map((s) => s.trim()) : DEFAULT_KEYS;
	const songs = keys.map((k) => {
		const s = SONGS.find((x) => x.key === k);
		if (!s) throw new Error(`Unknown song key "${k}". Known: ${SONGS.map((x) => x.key).join(", ")}`);
		return s;
	});

	const resolution = resolveLlmConfig("google-vertex");
	if (!resolution.ok) {
		console.error(resolution.reason);
		process.exit(1);
	}
	const llm = new LlmService(resolution.config);
	const fetcher = new DataFetcher({ cacheDir: join(SCRIPT_DIR, "../prompt-lab/.cache"), useCache: true });

	const v13 = getLyricalPrompt("13");
	const v17 = getLyricalPrompt("17");
	const byKey = new Map([...loadGoldExemplars().values()].map((g) => [g.key, g]));

	mkdirSync(OUT_DIR, { recursive: true });
	console.log(`Ship check — v13 (prod) vs v17 vs v17+rewrite, ${llm.getCurrentModel()}, ${songs.length} song(s)`);
	console.log(`HIGH columns: ${HIGH_RULES.map((r) => r.slice(0, 4)).join(" ")}\n`);

	const agg: Array<{ song: string; v13: number; v17: number; v17rw: number; v13t: number; v17t: number; v17rwt: number }> = [];

	for (const song of songs) {
		console.log(`${"=".repeat(80)}\n${song.artist} — ${song.title}`);
		const data = await fetcher.fetchSongData(song);
		if (!data.lyrics) {
			console.error(`  no lyrics for ${song.key}; skipping`);
			continue;
		}
		const genres = data.genres.length ? data.genres : (song.fallbackGenres ?? []);
		const exampleText = renderExemplarBlock(selectExemplars(song.key, byKey));
		const annotations = annotationsForKey(song.key);

		const v13Prompt = fillTemplate(v13.template, song, genres, data.audioFeaturesFormatted, data.lyrics, "", "");
		const v17Prompt = fillTemplate(v17.template, song, genres, data.audioFeaturesFormatted, data.lyrics, exampleText, annotations);

		const v13Gen = await genWithRetry(llm, v13Prompt, SongAnalysisLyricalSchema);
		const v17Gen = await genWithRetry(llm, v17Prompt, SongReadSchema);
		if (Result.isError(v13Gen)) {
			console.error(`  v13 generation error; skipping`, v13Gen.error);
			continue;
		}
		if (Result.isError(v17Gen)) {
			console.error(`  v17 generation error; skipping`, v17Gen.error);
			continue;
		}

		const v13Read = adaptLegacy(v13Gen.value.output);
		const v17Read = v17Gen.value.output;
		const rw = await rewriteRead(v17Read, llm, { maxPasses: 2 });

		const pV13 = profile(v13Read);
		const pV17 = profile(v17Read);
		const pRw = profile(rw.read);

		console.log(row("v13 (prod)", pV13));
		console.log(row("v17", pV17));
		console.log(row(`v17+rewrite ×${rw.passes}`, pRw));

		console.log(`\n  --- v13 prose (legacy) ---`);
		console.log(`    headline: ${v13Gen.value.output.headline}`);
		console.log(`    interpretation: ${v13Gen.value.output.interpretation}`);
		v13Gen.value.output.journey.forEach((j, i) => console.log(`    journey${i + 1} [${j.section}]: ${j.description}`));
		console.log(`    sonic_texture: ${v13Gen.value.output.sonic_texture}`);

		console.log(`\n  --- v17+rewrite prose ---`);
		console.log(`    lens: ${rw.read.lens}`);
		console.log(`    image: ${rw.read.image}`);
		console.log(`    take: ${rw.read.take}`);
		if (rw.read.contradiction) console.log(`    contradiction: ${rw.read.contradiction}`);
		rw.read.arc.forEach((b, i) => console.log(`    arc${i + 1} [${b.label}]: ${b.scene}`));
		if (rw.read.texture) console.log(`    texture: ${rw.read.texture}`);
		console.log("");

		writeFileSync(
			join(OUT_DIR, `${song.key}.json`),
			`${JSON.stringify({ song: song.key, v13: v13Gen.value.output, v17: v17Read, v17_rewrite: rw.read, rewritePasses: rw.passes }, null, 2)}\n`,
		);

		agg.push({
			song: song.key,
			v13: pV13.high, v17: pV17.high, v17rw: pRw.high,
			v13t: pV13.hits.filter((h) => TARGET_RULES.has(h.rule)).length,
			v17t: pV17.hits.filter((h) => TARGET_RULES.has(h.rule)).length,
			v17rwt: pRw.hits.filter((h) => TARGET_RULES.has(h.rule)).length,
		});
	}

	console.log(`${"=".repeat(80)}\nSUMMARY (Σhigh / targeted-tells per read)`);
	const sum = (f: (x: (typeof agg)[number]) => number) => agg.reduce((a, x) => a + f(x), 0);
	for (const a of agg) {
		console.log(`  ${a.song.padEnd(20)} v13 ${a.v13}/${a.v13t}   v17 ${a.v17}/${a.v17t}   v17+rw ${a.v17rw}/${a.v17rwt}`);
	}
	console.log(
		`\n  TOTAL Σhigh:    v13 ${sum((x) => x.v13)}   v17 ${sum((x) => x.v17)}   v17+rw ${sum((x) => x.v17rw)}` +
			`\n  TOTAL targeted: v13 ${sum((x) => x.v13t)}   v17 ${sum((x) => x.v17t)}   v17+rw ${sum((x) => x.v17rwt)}`,
	);
	console.log(
		`\nNote: tier1 measures REGISTER tells only. v13 was tuned to be tier1-clean already, so the headline\n` +
			`number is grounding/specificity/depth — which tier1 cannot see. Read the prose above (or run a paid\n` +
			`pairwise vs gold) to judge whether v17+rewrite keeps v17's richer, more grounded read.`,
	);
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});

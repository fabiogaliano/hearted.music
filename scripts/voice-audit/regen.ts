#!/usr/bin/env bun
/// <reference types="bun" />

// Regenerates song analyses with a chosen prompt version + model, runs the Tier-1
// voice rules over the fresh output, and records each run to experiments/. No DB
// writes. This is the tight loop for prompt tuning: pick a version, generate, score,
// compare against history.
//
//   bun scripts/voice-audit/regen.ts                          # active version, baseline song
//   bun scripts/voice-audit/regen.ts --version 9 --runs 3     # 3 runs of v9 on the baseline song
//   bun scripts/voice-audit/regen.ts --version 9 --songs fast --runs 3   # 2-song fast loop
//   bun scripts/voice-audit/regen.ts --version 9 --songs standard --runs 3
//   bun scripts/voice-audit/regen.ts --version 9 --songs final --runs 3  # full 8-song validation
//   bun scripts/voice-audit/regen.ts --songs ribs,too-sweet   # explicit keys
//   bun scripts/voice-audit/regen.ts --model gemini-2.5-pro   # try a stronger model

import { Result } from "better-result";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import {
	SongReadSchema,
	type SongRead,
} from "@/lib/domains/enrichment/content-analysis/read-schema";
import { renderAnnotationsBlockForPrompt } from "@/lib/domains/enrichment/content-analysis/grounding-annotations";
import {
	ACTIVE_LYRICAL_VERSION,
	getLyricalPrompt,
} from "@/lib/domains/enrichment/content-analysis/prompts/registry";
import { resolveLlmConfig } from "@/lib/integrations/llm/config";
import { LlmService, type LlmProviderName } from "@/lib/integrations/llm/service";
import { DataFetcher } from "../prompt-lab/data-fetcher";
import type { TestSong } from "../prompt-lab/test-songs";
import { loadGoldExemplars, renderExemplarBlock, type GoldExemplar } from "./exemplars";
import { makeRunId, recordRun, tallyHits } from "./experiments";
import { loadGroundingContext } from "./lyrics-context";
import { runAllRules } from "@/lib/domains/enrichment/content-analysis/voice/tier1-rules";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LYRICS_DIR = join(SCRIPT_DIR, "exemplars", "lyrics");

// Few-shot pool for the v17 {example} slot, in fixed priority order. All three are golds. For a
// given song we take the first EXAMPLE_COUNT entries that are NOT that song (leave-one-out), so a
// song never sees its own gold as an example. A non-pool target song (e.g. a non-gold harness
// song) takes the first two pool entries unchanged. The fixed prod pair (Not Like Us + Pink Pony
// Club) falls out of this rule for any song outside the pool. See plan WP1 "Locked decisions".
export const EXEMPLAR_POOL_KEYS = ["not-like-us", "pink-pony-club", "motion-sickness"];
export const EXAMPLE_COUNT = 2;

export function selectExemplars(
	currentKey: string,
	byKey: Map<string, GoldExemplar>,
): GoldExemplar[] {
	const out: GoldExemplar[] = [];
	for (const key of EXEMPLAR_POOL_KEYS) {
		if (out.length >= EXAMPLE_COUNT) break;
		if (key === currentKey) continue; // leave-one-out: never inject the song's own gold
		const gold = byKey.get(key);
		if (gold) out.push(gold);
	}
	return out;
}

// The current song's own vote-gated annotations — NOT leave-one-out, because a song seeing its
// own annotations is not leakage (plan WP1.7). Only the nine golds ship a lyrics+annotations
// file; any other harness song gets an empty block.
function annotationsForKey(key: string): string {
	if (!existsSync(join(LYRICS_DIR, `${key}.json`))) return "";
	return renderAnnotationsBlockForPrompt(loadGroundingContext(key).annotationsBlock);
}

interface HarnessSong extends TestSong {
	// Stable slug used to select songs from the CLI and to group experiment runs.
	key: string;
	// Used only when Spotify returns no genres for the track.
	fallbackGenres?: string[];
}

// The validation set, chosen for maximum spread across genre, energy, valence,
// acousticness, instrumentalness, and lyrical cadence (see the phase handoff). All
// are mainstream vocal tracks, so lyrics resolve via DataFetcher's external fetch.
//
// The entries after do-i-wanna-know are the remaining lyric-diagnostic songs, added
// Session 5.5 so the harness covers the full failure-mode spectrum the original
// spread did not (failure-mode types: hearted-read-spec.md §5). Failure modes probed:
// surface-true / lens-fabrication risk (Forever, No Sex For Ben), real depth but
// monochrome arc / manufactured-movement trap (Beautiful Things), two-act narrative
// the single-thesis lens fights (Pink Pony Club), tempo-emotion gap (As It Was),
// paradox-poor gratitude / power-flirt (God's Plan, Houdini), literary misdirection
// (Thinkin Bout You). Lyrics resolve by artist/title (cache is keyed that way, not by
// track id) and audio features are skipped, which the diagnostic deems acceptable (it
// found audio features unreliable as an emotion proxy). Four of them (Beautiful Things,
// Pink Pony Club, No Sex for Ben, As It Was) were promoted to gold exemplars in Session
// 5.5-continued and carry a slug spotifyTrackId purely as the run-to-gold join key — it
// is not a real Spotify id and is only ever string-matched against exemplars/index.json.
const SONGS: HarnessSong[] = [
	{ key: "not-like-us", artist: "Kendrick Lamar", title: "Not Like Us", spotifyTrackId: "6AI3ezQ4o3HUoP6Dhudph3", album: "Not Like Us", fallbackGenres: ["trap", "hip hop"] },
	{ key: "drivers-license", artist: "Olivia Rodrigo", title: "drivers license", spotifyTrackId: "4ml4WlnHDEpOK8HRVYTCWf", album: "SOUR" },
	{ key: "ribs", artist: "Lorde", title: "Ribs", spotifyTrackId: "2MvvoeRt8NcOXWESkxWn3g", album: "Pure Heroine" },
	{ key: "blinding-lights", artist: "The Weeknd", title: "Blinding Lights", spotifyTrackId: "0VjIjW4GlUZAMYd2vXMi3b", album: "After Hours" },
	{ key: "motion-sickness", artist: "Phoebe Bridgers", title: "Motion Sickness", spotifyTrackId: "5xo8RrjJ9CVNrtRg2S3B1R", album: "Stranger in the Alps" },
	{ key: "too-sweet", artist: "Hozier", title: "Too Sweet", spotifyTrackId: "3HMY0r2BAdpasXMY8rseR0", album: "Unheard" },
	{ key: "dtmf", artist: "Bad Bunny", title: "DtMF", spotifyTrackId: "3sK8wGT43QFpWrvNQsrQya", album: "DeBÍ TiRAR MáS FOToS" },
	{ key: "do-i-wanna-know", artist: "Arctic Monkeys", title: "Do I Wanna Know?", spotifyTrackId: "5FVd6KXrgO9B3JPmC8OPst", album: "AM" },
	{ key: "forever", artist: "Chris Brown", title: "Forever", album: "Exclusive: The Forever Edition", fallbackGenres: ["pop", "r&b", "dance-pop"] },
	{ key: "beautiful-things", artist: "Benson Boone", title: "Beautiful Things", spotifyTrackId: "beautiful-things", album: "Fireworks & Rollerblades", fallbackGenres: ["pop"] },
	{ key: "pink-pony-club", artist: "Chappell Roan", title: "Pink Pony Club", spotifyTrackId: "pink-pony-club", album: "The Rise and Fall of a Midwest Princess", fallbackGenres: ["pop", "synth-pop"] },
	{ key: "gods-plan", artist: "Drake", title: "God's Plan", album: "Scorpion", fallbackGenres: ["hip hop", "rap", "pop rap"] },
	{ key: "houdini", artist: "Dua Lipa", title: "Houdini", album: "Radical Optimism", fallbackGenres: ["pop", "dance-pop"] },
	{ key: "no-sex-for-ben", artist: "The Rapture", title: "No Sex for Ben", spotifyTrackId: "no-sex-for-ben", album: "Pieces of the People We Love", fallbackGenres: ["dance-punk", "indie rock"] },
	{ key: "as-it-was", artist: "Harry Styles", title: "As It Was", spotifyTrackId: "as-it-was", album: "Harry's House", fallbackGenres: ["pop", "synth-pop"] },
	{ key: "thinkin-bout-you", artist: "Frank Ocean", title: "Thinkin Bout You", album: "Channel Orange", fallbackGenres: ["r&b", "alternative r&b"] },
];

// Cost tiers: generation is the billed, slow step, scaling with songs × runs. Don't
// pay for breadth on every iteration. fast = iterate; standard = candidate check;
// final = promotion-only validation across the full spread.
const TIERS: Record<string, string[]> = {
	fast: ["not-like-us", "motion-sickness"],
	standard: ["not-like-us", "drivers-license", "ribs", "blinding-lights", "motion-sickness"],
	// The three songs whose lens/arc the diagnostic found hardest (manufactured movement,
	// narrative-vs-thesis, lens fabrication) — the fastest probe for v14's known weak spots.
	stress: ["forever", "beautiful-things", "pink-pony-club"],
	// The full 10-song lyric-diagnostic spread (failure-mode types: hearted-read-spec.md §5).
	diagnostic: ["gods-plan", "houdini", "forever", "no-sex-for-ben", "dtmf", "ribs", "beautiful-things", "as-it-was", "pink-pony-club", "thinkin-bout-you"],
	// The nine promoted golds — the canonical comparison set for baselines and variant runs.
	// Every key here is also an exemplars/index.json entry, so each one has a gold to judge against.
	golds: ["not-like-us", "drivers-license", "blinding-lights", "motion-sickness", "dtmf", "no-sex-for-ben", "beautiful-things", "pink-pony-club", "as-it-was"],
	final: SONGS.map((s) => s.key),
};

function songLabel(song: HarnessSong): string {
	return `${song.artist} — ${song.title}`;
}

function resolveSongs(arg: string): HarnessSong[] {
	const tier = TIERS[arg];
	const keys = tier ?? arg.split(",").map((k) => k.trim()).filter(Boolean);
	const out: HarnessSong[] = [];
	for (const key of keys) {
		const song = SONGS.find((s) => s.key === key);
		if (!song) {
			throw new Error(
				`Unknown song "${key}". Tiers: ${Object.keys(TIERS).join(", ")}. Keys: ${SONGS.map((s) => s.key).join(", ")}`,
			);
		}
		out.push(song);
	}
	return out;
}

interface Flags {
	version: string;
	model?: string;
	provider: LlmProviderName;
	runs: number;
	songs: string;
	temperature?: number;
	// Suppress both runtime-injected slots ({example} + {annotations}) even when the template
	// has them. Lets the harness reproduce TODAY'S prod path (v17 with empty slots) so a WITH-vs-
	// WITHOUT run isolates the few-shot lever. Default off = the eval's normal injected behaviour.
	noInjection: boolean;
}

function parseFlags(argv: string[]): Flags {
	// Default to Vertex (GCP-billed gemini-2.5-flash, no AI-Studio free-tier 20/min cap).
	// Same model as the original free-tier runs, so scores stay comparable.
	// Default song is the baseline worst-case, preserving the historical single-song run.
	const out: Flags = {
		version: ACTIVE_LYRICAL_VERSION,
		provider: "google-vertex",
		runs: 1,
		songs: "not-like-us",
		noInjection: false,
	};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--version") out.version = argv[++i];
		else if (argv[i] === "--model") out.model = argv[++i];
		else if (argv[i] === "--provider") out.provider = argv[++i] as LlmProviderName;
		else if (argv[i] === "--runs") out.runs = Math.max(1, Number(argv[++i]) || 1);
		else if (argv[i] === "--songs") out.songs = argv[++i];
		else if (argv[i] === "--temperature" || argv[i] === "--temp")
			out.temperature = Number(argv[++i]);
		else if (argv[i] === "--no-injection") out.noInjection = true;
	}
	return out;
}

function buildPrompt(
	song: HarnessSong,
	template: string,
	genres: string[],
	audioFeatures: string,
	lyrics: string,
	exampleText: string,
	annotations: string,
): string {
	// Function replacers throughout: gold prose and annotations can contain "$", which the
	// string form of .replace would interpret as a special replacement pattern.
	return template
		.replace("{artist}", () => song.artist)
		.replace("{title}", () => song.title)
		.replace("{genres}", () => (genres.length ? genres.join(", ") : "Unknown"))
		.replace("{audio_features}", () => audioFeatures)
		.replace("{lyrics}", () => lyrics)
		.replace("{example}", () => exampleText)
		.replace("{annotations}", () => annotations);
}

function printAudit(
	label: string,
	analysis: SongRead,
	hits: ReturnType<typeof runAllRules>,
): void {
	const { totals } = tallyHits(hits);
	console.log(`\n=== ${label} ===`);
	console.log(`${totals.high} high / ${totals.medium} medium / ${totals.low} low\n`);
	console.log(`lens:  ${analysis.lens}`);
	console.log(`image: ${analysis.image}`);
	console.log(`take:  ${analysis.take}`);
	console.log("arc:");
	for (const beat of analysis.arc) console.log(`  • ${beat.scene}`);
	if (hits.length) {
		console.log("\nhits:");
		for (const h of hits)
			console.log(`  [${h.severity}] ${h.rule} (${h.field}): "${h.span.slice(0, 80)}"`);
	} else {
		console.log("\nno rule hits — clean.");
	}
}

interface SongResult {
	label: string;
	high: number[];
	medium: number[];
	dash: number[];
}

function mean(xs: number[]): number {
	return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

async function main() {
	const flags = parseFlags(process.argv.slice(2));
	const prompt = getLyricalPrompt(flags.version);
	// All shipped prompts emit the redesigned { read } model, so generation always
	// validates against SongReadSchema (the audit step requires the read shape).
	const genSchema: z.ZodTypeAny = SongReadSchema;
	const songs = resolveSongs(flags.songs);

	const resolution = resolveLlmConfig(flags.provider);
	if (!resolution.ok) {
		console.error(resolution.reason);
		process.exit(1);
	}
	const llm = new LlmService(
		flags.model ? { ...resolution.config, model: flags.model } : resolution.config,
	);

	const fetcher = new DataFetcher({
		cacheDir: join(SCRIPT_DIR, "../prompt-lab/.cache"),
		useCache: true,
	});

	// v17+ injects a leave-one-out {example} few-shot block and the song's own vote-gated
	// {annotations}. Only build the gold lookup when the active template actually has the slots.
	const wantsInjection =
		prompt.template.includes("{example}") ||
		prompt.template.includes("{annotations}");
	const byKey = wantsInjection
		? new Map([...loadGoldExemplars().values()].map((g) => [g.key, g]))
		: new Map<string, GoldExemplar>();

	const injectionLabel = !wantsInjection
		? "template has no {example}/{annotations} slots"
		: flags.noInjection
			? "INJECTION OFF — empty {example}+{annotations} (simulates TODAY'S prod)"
			: "INJECTION ON — fixed-pool {example} + per-song {annotations} (eval / planned prod)";
	console.log(`\nslots: ${injectionLabel}`);

	const detailed = songs.length === 1 && flags.runs === 1;
	const results: SongResult[] = [];

	for (const song of songs) {
		const label = songLabel(song);
		console.log(`\nFetching data for ${label}...`);
		const data = await fetcher.fetchSongData(song);
		if (data.errors.length) console.error("fetch warnings:", data.errors);
		if (!data.lyrics) {
			console.error(`No lyrics fetched for ${label} — skipping (cannot run a lyrical generation).`);
			continue;
		}

		const inject = wantsInjection && !flags.noInjection;
		const exampleText = inject
			? renderExemplarBlock(selectExemplars(song.key, byKey))
			: "";
		const annotations = inject ? annotationsForKey(song.key) : "";

		const builtPrompt = buildPrompt(
			song,
			prompt.template,
			data.genres.length ? data.genres : (song.fallbackGenres ?? []),
			data.audioFeaturesFormatted,
			data.lyrics,
			exampleText,
			annotations,
		);

		const result: SongResult = { label, high: [], medium: [], dash: [] };
		for (let i = 0; i < flags.runs; i++) {
			const tempLabel =
				flags.temperature === undefined ? "default temp" : `temp ${flags.temperature}`;
			console.log(
				`\n[${label}] [run ${i + 1}/${flags.runs}] prompt v${prompt.version} via ${llm.getCurrentModel()} (${tempLabel})...`,
			);
			const gen = await llm.generateObject(builtPrompt, genSchema, {
				maxOutputTokens: 4000,
				temperature: flags.temperature,
			});
			if (Result.isError(gen)) {
				console.error("LLM error:", gen.error);
				continue;
			}

			// The experiment store and Tier-1 rules grade the read shape. A pre-v14 prompt
			// emits the legacy model, which can't be audited or recorded under the new rules.
			const parsed = SongReadSchema.safeParse(gen.value.output);
			if (!parsed.success) {
				console.error(
					`v${prompt.version} emits the legacy 8-field shape; voice-audit now grades the { read } model. Use --version 14+ to audit and record.`,
				);
				continue;
			}
			const analysis = parsed.data;
			const hits = runAllRules(analysis);
			const { totals, byRule } = tallyHits(hits);
			if (detailed) printAudit(label, analysis, hits);
			else
				console.log(
					`  ${totals.high} high / ${totals.medium} medium / ${totals.low} low  (dash×${byRule.dash ?? 0})`,
				);
			result.high.push(totals.high);
			result.medium.push(totals.medium);
			result.dash.push(byRule.dash ?? 0);

			recordRun({
				runId: makeRunId(label, prompt.version, gen.value.model, flags.temperature),
				timestamp: new Date().toISOString(),
				song: label,
				spotifyTrackId: song.spotifyTrackId ?? "",
				promptKind: "lyrical",
				promptVersion: prompt.version,
				model: gen.value.model,
				temperature: flags.temperature,
				totals,
				byRule,
				tokens: gen.value.tokens?.total,
				hits,
				analysis,
			});
		}
		results.push(result);
	}

	if (!detailed && results.length) {
		console.log(`\n=== v${prompt.version} summary (${flags.runs} run(s) each) ===`);
		for (const r of results) {
			console.log(
				`${r.label}\n  high [${r.high.join(", ")}] mean ${mean(r.high).toFixed(1)}  ` +
					`medium [${r.medium.join(", ")}] mean ${mean(r.medium).toFixed(1)}  ` +
					`dash [${r.dash.join(", ")}] total ${r.dash.reduce((a, b) => a + b, 0)}`,
			);
		}
		const allHigh = results.flatMap((r) => r.high);
		const allMedium = results.flatMap((r) => r.medium);
		const allDash = results.flatMap((r) => r.dash);
		console.log(
			`\noverall: mean-high ${mean(allHigh).toFixed(2)}, mean-medium ${mean(allMedium).toFixed(2)}, total-dash ${allDash.reduce((a, b) => a + b, 0)}`,
		);
	}
	process.exit(0);
}

// Guarded so tests can import the pure selection helpers without running a generation pass.
if (import.meta.main) {
	main().catch((err) => {
		console.error(err);
		process.exit(2);
	});
}

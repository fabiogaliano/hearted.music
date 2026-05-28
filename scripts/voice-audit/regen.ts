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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	SongAnalysisLyricalSchema,
	type SongAnalysisLyrical,
} from "@/lib/domains/enrichment/content-analysis/song-analysis";
import {
	ACTIVE_LYRICAL_VERSION,
	getLyricalPrompt,
} from "@/lib/domains/enrichment/content-analysis/prompts/registry";
import { resolveLlmConfig } from "@/lib/integrations/llm/config";
import { LlmService, type LlmProviderName } from "@/lib/integrations/llm/service";
import { DataFetcher } from "../prompt-lab/data-fetcher";
import type { TestSong } from "../prompt-lab/test-songs";
import { makeRunId, recordRun, tallyHits } from "./experiments";
import { runAllRules } from "./tier1/rules";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

interface HarnessSong extends TestSong {
	// Stable slug used to select songs from the CLI and to group experiment runs.
	key: string;
	// Used only when Spotify returns no genres for the track.
	fallbackGenres?: string[];
}

// The validation set, chosen for maximum spread across genre, energy, valence,
// acousticness, instrumentalness, and lyrical cadence (see the phase handoff). All
// are mainstream vocal tracks, so lyrics resolve via DataFetcher's external fetch.
const SONGS: HarnessSong[] = [
	{ key: "not-like-us", artist: "Kendrick Lamar", title: "Not Like Us", spotifyTrackId: "6AI3ezQ4o3HUoP6Dhudph3", album: "Not Like Us", fallbackGenres: ["trap", "hip hop"] },
	{ key: "drivers-license", artist: "Olivia Rodrigo", title: "drivers license", spotifyTrackId: "4ml4WlnHDEpOK8HRVYTCWf", album: "SOUR" },
	{ key: "ribs", artist: "Lorde", title: "Ribs", spotifyTrackId: "2MvvoeRt8NcOXWESkxWn3g", album: "Pure Heroine" },
	{ key: "blinding-lights", artist: "The Weeknd", title: "Blinding Lights", spotifyTrackId: "0VjIjW4GlUZAMYd2vXMi3b", album: "After Hours" },
	{ key: "motion-sickness", artist: "Phoebe Bridgers", title: "Motion Sickness", spotifyTrackId: "5xo8RrjJ9CVNrtRg2S3B1R", album: "Stranger in the Alps" },
	{ key: "too-sweet", artist: "Hozier", title: "Too Sweet", spotifyTrackId: "3HMY0r2BAdpasXMY8rseR0", album: "Unheard" },
	{ key: "dtmf", artist: "Bad Bunny", title: "DtMF", spotifyTrackId: "3sK8wGT43QFpWrvNQsrQya", album: "DeBÍ TiRAR MáS FOToS" },
	{ key: "do-i-wanna-know", artist: "Arctic Monkeys", title: "Do I Wanna Know?", spotifyTrackId: "5FVd6KXrgO9B3JPmC8OPst", album: "AM" },
];

// Cost tiers: generation is the billed, slow step, scaling with songs × runs. Don't
// pay for breadth on every iteration. fast = iterate; standard = candidate check;
// final = promotion-only validation across the full spread.
const TIERS: Record<string, string[]> = {
	fast: ["not-like-us", "motion-sickness"],
	standard: ["not-like-us", "drivers-license", "ribs", "blinding-lights", "motion-sickness"],
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
	};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--version") out.version = argv[++i];
		else if (argv[i] === "--model") out.model = argv[++i];
		else if (argv[i] === "--provider") out.provider = argv[++i] as LlmProviderName;
		else if (argv[i] === "--runs") out.runs = Math.max(1, Number(argv[++i]) || 1);
		else if (argv[i] === "--songs") out.songs = argv[++i];
		else if (argv[i] === "--temperature" || argv[i] === "--temp")
			out.temperature = Number(argv[++i]);
	}
	return out;
}

function buildPrompt(
	song: HarnessSong,
	template: string,
	genres: string[],
	audioFeatures: string,
	lyrics: string,
): string {
	return template
		.replace("{artist}", () => song.artist)
		.replace("{title}", () => song.title)
		.replace("{genres}", () => (genres.length ? genres.join(", ") : "Unknown"))
		.replace("{audio_features}", () => audioFeatures)
		.replace("{lyrics}", () => lyrics);
}

function printAudit(
	label: string,
	analysis: SongAnalysisLyrical,
	hits: ReturnType<typeof runAllRules>,
): void {
	const { totals } = tallyHits(hits);
	console.log(`\n=== ${label} ===`);
	console.log(`${totals.high} high / ${totals.medium} medium / ${totals.low} low\n`);
	console.log(`interpretation: ${analysis.interpretation}`);
	console.log(`headline:       ${analysis.headline}`);
	console.log("journey:");
	for (const j of analysis.journey) console.log(`  • ${j.description}`);
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

		const builtPrompt = buildPrompt(
			song,
			prompt.template,
			data.genres.length ? data.genres : (song.fallbackGenres ?? []),
			data.audioFeaturesFormatted,
			data.lyrics,
		);

		const result: SongResult = { label, high: [], medium: [], dash: [] };
		for (let i = 0; i < flags.runs; i++) {
			const tempLabel =
				flags.temperature === undefined ? "default temp" : `temp ${flags.temperature}`;
			console.log(
				`\n[${label}] [run ${i + 1}/${flags.runs}] prompt v${prompt.version} via ${llm.getCurrentModel()} (${tempLabel})...`,
			);
			const gen = await llm.generateObject(builtPrompt, SongAnalysisLyricalSchema, {
				maxOutputTokens: 4000,
				temperature: flags.temperature,
			});
			if (Result.isError(gen)) {
				console.error("LLM error:", gen.error);
				continue;
			}

			const analysis = gen.value.output as SongAnalysisLyrical;
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

main().catch((err) => {
	console.error(err);
	process.exit(2);
});

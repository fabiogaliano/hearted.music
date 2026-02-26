#!/usr/bin/env bun

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { Result } from "better-result";
import { LlmService } from "@/lib/ml/llm/service";
import { LyricalAnalysisSchema, InstrumentalAnalysisSchema } from "./schema";
import { PROMPT_VARIANTS, type PromptContext } from "./prompts";
import { DEFAULT_TEST_SONGS, type TestSong } from "./test-songs";
import { DataFetcher, type SongData } from "./data-fetcher";
import { generateReport, type AnalysisRun } from "./report";
import {
	saveResult,
	loadResult,
	loadAllResults,
	loadResultsForVariants,
	listCachedVariants,
} from "./result-cache";

const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
};

const DEFAULT_MODELS: Record<string, string> = {
	google: "gemini-2.0-flash",
	anthropic: "claude-sonnet-4-20250514",
	openai: "gpt-4o-mini",
};

const MODEL_ALIASES: Record<string, string> = {
	haiku: "claude-haiku-4-5-20251001",
	sonnet: "claude-sonnet-4-20250514",
	opus: "claude-opus-4-20250514",
	flash: "gemini-2.0-flash",
};

type LlmProvider = "google" | "anthropic" | "openai";

interface CliArgs {
	songs: TestSong[];
	promptIds: string[] | null;
	useCache: boolean;
	outputPath: string;
	reportOnly: boolean;
	provider: LlmProvider;
	model: string;
}

function resolveModel(provider: LlmProvider, modelArg?: string): string {
	if (!modelArg) return DEFAULT_MODELS[provider];
	return MODEL_ALIASES[modelArg] ?? modelArg;
}

function getApiKey(provider: LlmProvider): string {
	const envKeys: Record<string, string> = {
		google: "GEMINI_API_KEY",
		anthropic: "ANTHROPIC_API_KEY",
		openai: "OPENAI_API_KEY",
	};
	const key = process.env[envKeys[provider]];
	if (!key) {
		console.error(`${colors.red}${envKeys[provider]} environment variable is required.${colors.reset}`);
		process.exit(1);
	}
	return key;
}

function parseArgs(): CliArgs {
	const args = process.argv.slice(2);
	let promptIds: string[] | null = null;
	let useCache = true;
	let outputPath: string | null = null;
	let reportOnly = false;
	let provider: LlmProvider = "google";
	let modelArg: string | undefined;
	const songPairs: TestSong[] = [];

	let i = 0;
	while (i < args.length) {
		const arg = args[i];

		if (arg === "--report") {
			reportOnly = true;
			i++;
			continue;
		}

		if (arg === "--prompts") {
			i++;
			if (i < args.length) {
				promptIds = args[i].split(",").map((s) => s.trim());
			}
			i++;
			continue;
		}

		if (arg === "--no-cache") {
			useCache = false;
			i++;
			continue;
		}

		if (arg === "--out") {
			i++;
			if (i < args.length) {
				outputPath = args[i].startsWith("/")
					? args[i]
					: join(__dirname, args[i]);
			}
			i++;
			continue;
		}

		if (arg === "--provider") {
			i++;
			if (i < args.length) {
				provider = args[i] as LlmProvider;
			}
			i++;
			continue;
		}

		if (arg === "--model") {
			i++;
			if (i < args.length) {
				modelArg = args[i];
			}
			i++;
			continue;
		}

		if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
			songPairs.push({ artist: args[i], title: args[i + 1] });
			i += 2;
			continue;
		}

		console.error(`${colors.red}Unknown argument: ${arg}${colors.reset}`);
		process.exit(1);
	}

	const model = resolveModel(provider, modelArg);

	return {
		songs: songPairs.length > 0 ? songPairs : DEFAULT_TEST_SONGS,
		promptIds,
		useCache,
		outputPath: outputPath ?? join(__dirname, `report-${model}.html`),
		reportOnly,
		provider,
		model,
	};
}

function printBanner(model: string): void {
	console.log();
	console.log(`${colors.cyan}\u2554${"═".repeat(51)}\u2557`);
	console.log(`\u2551         Prompt Lab${" ".repeat(32)}\u2551`);
	console.log(`\u255a${"═".repeat(51)}\u255d${colors.reset}`);
	console.log(`  ${colors.dim}Model: ${model}${colors.reset}`);
	console.log();
}

function formatSongLabel(song: TestSong): string {
	return `${song.artist} \u2014 ${song.title}`;
}

function formatDataStatus(data: SongData): string {
	const parts: string[] = [];
	if (data.lyrics) parts.push("lyrics");
	if (data.audioFeaturesFormatted && !data.audioFeaturesFormatted.includes("not available")) {
		parts.push("audio");
	}
	if (data.genres.length > 0) parts.push("genres");
	return parts.join(" + ");
}

function formatTokenCount(n: number): string {
	return n.toLocaleString("en-US");
}

function buildReport(
	runs: AnalysisRun[],
	songs: TestSong[],
	outputPath: string,
): void {
	const variantOrder = PROMPT_VARIANTS.map((v) => v.id);
	runs.sort((a, b) => {
		const aIdx = variantOrder.indexOf(a.variantId);
		const bIdx = variantOrder.indexOf(b.variantId);
		return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
	});

	const variantNames = new Map<string, string>();
	for (const run of runs) {
		variantNames.set(run.variantId, run.variantName);
	}

	const html = generateReport(runs, variantNames, songs);
	writeFileSync(outputPath, html, "utf-8");

	const relativeOutput = outputPath.replace(join(__dirname, "../../"), "");
	const variantCount = variantNames.size;
	const songCount = new Set(runs.map((r) => `${r.song.artist}::${r.song.title}`)).size;

	console.log();
	console.log(`${colors.green}\u2192 Report written to ${relativeOutput}${colors.reset}`);
	console.log(`  ${variantCount} variants \u00d7 ${songCount} songs = ${runs.length} analyses`);
	console.log();
}

async function runReport(cliArgs: CliArgs): Promise<void> {
	const cacheDir = join(__dirname, ".cache");

	const cached = cliArgs.promptIds
		? loadResultsForVariants(cacheDir, cliArgs.model, cliArgs.promptIds)
		: loadAllResults(cacheDir, cliArgs.model);

	if (cached.length === 0) {
		const available = listCachedVariants(cacheDir, cliArgs.model);
		if (available.length > 0) {
			console.log(`${colors.yellow}No results found for specified variants.${colors.reset}`);
			console.log(`  Available: ${available.join(", ")}`);
		} else {
			console.log(`${colors.yellow}No cached results for model ${cliArgs.model}. Run without --report first.${colors.reset}`);
		}
		process.exit(1);
	}

	const songSet = new Set(cliArgs.songs.map((s) => `${s.artist}::${s.title}`));
	const hasSongFilter = cliArgs.songs !== DEFAULT_TEST_SONGS || process.argv.some((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]);

	const filtered = hasSongFilter
		? cached.filter((r) => songSet.has(`${r.song.artist}::${r.song.title}`))
		: cached;

	const songs = [
		...new Map(filtered.map((r) => [`${r.song.artist}::${r.song.title}`, r.song])).values(),
	];

	console.log(`${colors.cyan}\u2192 Building report from ${filtered.length} cached results...${colors.reset}`);
	buildReport(filtered, songs, cliArgs.outputPath);
}

async function runAnalysis(cliArgs: CliArgs): Promise<void> {
	const apiKey = getApiKey(cliArgs.provider);

	if (!process.env.GENIUS_CLIENT_TOKEN) {
		console.warn(`${colors.yellow}\u26a0 GENIUS_CLIENT_TOKEN not set — lyrics fetching may fail${colors.reset}`);
	}
	if (!process.env.LASTFM_API_KEY) {
		console.warn(`${colors.yellow}\u26a0 LASTFM_API_KEY not set — genre fetching may fail${colors.reset}`);
	}

	const variants = cliArgs.promptIds
		? PROMPT_VARIANTS.filter((v) => cliArgs.promptIds!.includes(v.id))
		: PROMPT_VARIANTS;

	if (variants.length === 0) {
		console.error(`${colors.red}No matching prompt variants found.${colors.reset}`);
		process.exit(1);
	}

	const cacheDir = join(__dirname, ".cache");
	const fetcher = new DataFetcher({ useCache: cliArgs.useCache, cacheDir });

	console.log(`${colors.cyan}\u2192 Fetching song data...${colors.reset}`);

	const songDataMap = new Map<string, SongData>();

	for (const song of cliArgs.songs) {
		const data = await fetcher.fetchSongData(song);
		const key = `${song.artist}::${song.title}`;
		songDataMap.set(key, data);

		const status = formatDataStatus(data);
		const hasWarnings = data.errors.length > 0;
		const icon = hasWarnings ? `${colors.yellow}\u26a0` : `${colors.green}\u2713`;
		const suffix = hasWarnings
			? ` ${colors.dim}(${data.errors.join(", ")})${colors.reset}`
			: "";
		console.log(`  ${icon} ${formatSongLabel(song)} (${status})${colors.reset}${suffix}`);
	}

	console.log();
	console.log(`${colors.cyan}\u2192 Running analysis...${colors.reset}`);

	const llm = new LlmService({
		provider: cliArgs.provider,
		apiKey,
		model: cliArgs.model,
	});

	const newRuns: AnalysisRun[] = [];
	let totalTokens = 0;
	let cacheHits = 0;

	for (const variant of variants) {
		for (const song of cliArgs.songs) {
			const key = `${song.artist}::${song.title}`;
			const data = songDataMap.get(key)!;

			if (cliArgs.useCache) {
				const cached = loadResult(cacheDir, cliArgs.model, variant.id, song.artist, song.title);
				if (cached) {
					newRuns.push(cached);
					cacheHits++;
					console.log(
						`  ${colors.dim}[${variant.name}] ${formatSongLabel(song)}... cached${colors.reset}`,
					);
					continue;
				}
			}

			const promptCtx: PromptContext = {
				artist: song.artist,
				title: song.title,
				lyrics: data.lyrics,
				audioFeatures: data.audioFeaturesFormatted,
				genres: data.genres,
			};

			const prompt = variant.buildPrompt(promptCtx);
			const schema = data.lyrics ? LyricalAnalysisSchema : InstrumentalAnalysisSchema;

			const startTime = performance.now();
			const result = await llm.generateObject(prompt, schema);
			const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

			if (Result.isError(result)) {
				const errorMsg = result.error.message;
				console.log(
					`  ${colors.red}[${variant.name}] ${formatSongLabel(song)}... FAILED (${errorMsg})${colors.reset}`,
				);
				const run: AnalysisRun = {
					variantId: variant.id,
					variantName: variant.name,
					song,
					output: null,
					error: errorMsg,
					durationMs: performance.now() - startTime,
					tokens: null,
					prompt,
					timestamp: new Date().toISOString(),
				};
				newRuns.push(run);
				continue;
			}

			const tokens = result.value.tokens?.total ?? 0;
			totalTokens += tokens;

			console.log(
				`  ${colors.dim}[${variant.name}]${colors.reset} ${formatSongLabel(song)}... ${elapsed}s (${formatTokenCount(tokens)} tokens)`,
			);

			const run: AnalysisRun = {
				variantId: variant.id,
				variantName: variant.name,
				song,
				output: result.value.output as Record<string, unknown>,
				error: null,
				durationMs: performance.now() - startTime,
				tokens: result.value.tokens ?? null,
				prompt,
				timestamp: new Date().toISOString(),
			};

			saveResult(cacheDir, cliArgs.model, run);
			newRuns.push(run);
		}
	}

	if (cacheHits > 0) {
		console.log(`  ${colors.dim}(${cacheHits} from cache)${colors.reset}`);
	}

	console.log();
	console.log(`${colors.cyan}\u2192 Generating report...${colors.reset}`);

	const allCached = loadAllResults(cacheDir, cliArgs.model);

	const songSet = new Set(cliArgs.songs.map((s) => `${s.artist}::${s.title}`));
	const reportRuns = allCached.filter((r) =>
		songSet.has(`${r.song.artist}::${r.song.title}`),
	);

	buildReport(reportRuns, cliArgs.songs, cliArgs.outputPath);

	if (totalTokens > 0) {
		console.log(`  Total tokens (new calls): ${formatTokenCount(totalTokens)}`);
		console.log();
	}
}

async function main(): Promise<void> {
	const cliArgs = parseArgs();

	printBanner(cliArgs.model);

	if (cliArgs.reportOnly) {
		await runReport(cliArgs);
	} else {
		await runAnalysis(cliArgs);
	}
}

main().catch((error) => {
	console.error(`${colors.red}Fatal error:${colors.reset}`, error);
	process.exit(1);
});

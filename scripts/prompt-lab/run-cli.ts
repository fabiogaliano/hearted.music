#!/usr/bin/env bun

/**
 * Runs prompt lab analysis via Claude Code CLI (`claude -p`).
 * No API keys needed — uses your existing Claude Code auth.
 *
 * Usage:
 *   bun scripts/prompt-lab/run-cli.ts --model haiku
 *   bun scripts/prompt-lab/run-cli.ts --model haiku --prompts v6_prose_narrative
 *   bun scripts/prompt-lab/run-cli.ts --model haiku "Lorde" "Ribs"
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { PROMPT_VARIANTS, type PromptContext } from "./prompts";
import { DEFAULT_TEST_SONGS, type TestSong } from "./test-songs";
import { DataFetcher, type SongData } from "./data-fetcher";
import { generateReport, type AnalysisRun } from "./report";
import {
	saveResult,
	loadResult,
	loadAllResults,
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

const LYRICAL_JSON_SCHEMA = JSON.stringify({
	type: "object",
	properties: {
		headline: { type: "string" },
		compound_mood: { type: "string" },
		mood_description: { type: "string" },
		interpretation: { type: "string" },
		themes: {
			type: "array",
			items: {
				type: "object",
				properties: { name: { type: "string" }, description: { type: "string" } },
				required: ["name", "description"],
			},
		},
		journey: {
			type: "array",
			items: {
				type: "object",
				properties: { section: { type: "string" }, mood: { type: "string" }, description: { type: "string" } },
				required: ["section", "mood", "description"],
			},
		},
		key_lines: {
			type: "array",
			items: {
				type: "object",
				properties: { line: { type: "string" }, insight: { type: "string" } },
				required: ["line", "insight"],
			},
		},
		sonic_texture: { type: "string" },
	},
	required: ["headline", "compound_mood", "mood_description", "interpretation", "themes", "journey", "key_lines", "sonic_texture"],
});

const INSTRUMENTAL_JSON_SCHEMA = JSON.stringify({
	type: "object",
	properties: {
		headline: { type: "string" },
		compound_mood: { type: "string" },
		mood_description: { type: "string" },
		sonic_texture: { type: "string" },
	},
	required: ["headline", "compound_mood", "mood_description", "sonic_texture"],
});

interface CliArgs {
	songs: TestSong[];
	promptIds: string[] | null;
	useCache: boolean;
	model: string;
	outputPath: string;
}

function parseArgs(): CliArgs {
	const args = process.argv.slice(2);
	let promptIds: string[] | null = null;
	let useCache = true;
	let model = "haiku";
	let outputPath: string | null = null;
	const songPairs: TestSong[] = [];

	let i = 0;
	while (i < args.length) {
		const arg = args[i];

		if (arg === "--model") {
			i++;
			if (i < args.length) model = args[i];
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
				outputPath = args[i].startsWith("/") ? args[i] : join(__dirname, args[i]);
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

	return {
		songs: songPairs.length > 0 ? songPairs : DEFAULT_TEST_SONGS,
		promptIds,
		useCache,
		model,
		outputPath: outputPath ?? join(__dirname, `report-${model}.html`),
	};
}

interface ClaudeCliResult {
	output: Record<string, unknown> | null;
	error: string | null;
	tokens: { prompt: number; completion: number; total: number } | null;
}

async function callClaude(prompt: string, model: string, jsonSchema: string): Promise<ClaudeCliResult> {
	const proc = Bun.spawn(
		[
			"claude",
			"-p",
			"--model", model,
			"--output-format", "json",
			"--system-prompt", "You are a music analysis engine. Follow the user's instructions exactly. Return only the structured JSON.",
			"--no-session-persistence",
			"--tools", "",
			"--disable-slash-commands",
			"--json-schema", jsonSchema,
		],
		{
			stdin: new TextEncoder().encode(prompt),
			stdout: "pipe",
			stderr: "pipe",
		},
	);

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		return { output: null, error: stderr.trim() || `Exit code ${exitCode}`, tokens: null };
	}

	try {
		const response = JSON.parse(stdout);

		if (response.is_error || !response.structured_output) {
			return { output: null, error: response.result || "No structured output", tokens: null };
		}

		const usage = response.usage ?? {};
		const inputTokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
		const outputTokens = usage.output_tokens ?? 0;

		return {
			output: response.structured_output,
			error: null,
			tokens: {
				prompt: inputTokens,
				completion: outputTokens,
				total: inputTokens + outputTokens,
			},
		};
	} catch {
		return { output: null, error: `Failed to parse response: ${stdout.slice(0, 200)}`, tokens: null };
	}
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

async function main(): Promise<void> {
	const cliArgs = parseArgs();
	const cacheDir = join(__dirname, ".cache");

	const variants = cliArgs.promptIds
		? PROMPT_VARIANTS.filter((v) => cliArgs.promptIds!.includes(v.id))
		: PROMPT_VARIANTS;

	if (variants.length === 0) {
		console.error(`${colors.red}No matching prompt variants found.${colors.reset}`);
		process.exit(1);
	}

	console.log();
	console.log(`${colors.cyan}\u2554${"═".repeat(51)}\u2557`);
	console.log(`\u2551         Prompt Lab (CLI)${" ".repeat(27)}\u2551`);
	console.log(`\u255a${"═".repeat(51)}\u255d${colors.reset}`);
	console.log(`  ${colors.dim}Model: ${cliArgs.model} via claude -p${colors.reset}`);
	console.log();

	const fetcher = new DataFetcher({ useCache: true, cacheDir });

	console.log(`${colors.cyan}\u2192 Fetching song data...${colors.reset}`);

	const songDataMap = new Map<string, SongData>();
	for (const song of cliArgs.songs) {
		const data = await fetcher.fetchSongData(song);
		songDataMap.set(`${song.artist}::${song.title}`, data);

		const status = formatDataStatus(data);
		const hasWarnings = data.errors.length > 0;
		const icon = hasWarnings ? `${colors.yellow}\u26a0` : `${colors.green}\u2713`;
		const suffix = hasWarnings ? ` ${colors.dim}(${data.errors.join(", ")})${colors.reset}` : "";
		console.log(`  ${icon} ${formatSongLabel(song)} (${status})${colors.reset}${suffix}`);
	}

	console.log();
	console.log(`${colors.cyan}\u2192 Running analysis via claude -p...${colors.reset}`);

	const runs: AnalysisRun[] = [];
	let totalTokens = 0;
	let cacheHits = 0;

	for (const variant of variants) {
		for (const song of cliArgs.songs) {
			const data = songDataMap.get(`${song.artist}::${song.title}`)!;

			if (cliArgs.useCache) {
				const cached = loadResult(cacheDir, cliArgs.model, variant.id, song.artist, song.title);
				if (cached) {
					runs.push(cached);
					cacheHits++;
					console.log(`  ${colors.dim}[${variant.name}] ${formatSongLabel(song)}... cached${colors.reset}`);
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
			const schema = data.lyrics ? LYRICAL_JSON_SCHEMA : INSTRUMENTAL_JSON_SCHEMA;

			const startTime = performance.now();
			const result = await callClaude(prompt, cliArgs.model, schema);
			const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

			if (result.error) {
				console.log(`  ${colors.red}[${variant.name}] ${formatSongLabel(song)}... FAILED (${result.error.slice(0, 80)})${colors.reset}`);
				const run: AnalysisRun = {
					variantId: variant.id,
					variantName: variant.name,
					song,
					output: null,
					error: result.error,
					durationMs: performance.now() - startTime,
					tokens: null,
					prompt,
					timestamp: new Date().toISOString(),
				};
				runs.push(run);
				continue;
			}

			const tokens = result.tokens?.total ?? 0;
			totalTokens += tokens;

			console.log(`  ${colors.dim}[${variant.name}]${colors.reset} ${formatSongLabel(song)}... ${elapsed}s (${formatTokenCount(tokens)} tokens)`);

			const run: AnalysisRun = {
				variantId: variant.id,
				variantName: variant.name,
				song,
				output: result.output,
				error: null,
				durationMs: performance.now() - startTime,
				tokens: result.tokens,
				prompt,
				timestamp: new Date().toISOString(),
			};

			saveResult(cacheDir, cliArgs.model, run);
			runs.push(run);
		}
	}

	if (cacheHits > 0) {
		console.log(`  ${colors.dim}(${cacheHits} from cache)${colors.reset}`);
	}

	console.log();
	console.log(`${colors.cyan}\u2192 Generating report...${colors.reset}`);

	const allCached = loadAllResults(cacheDir, cliArgs.model);
	const songSet = new Set(cliArgs.songs.map((s) => `${s.artist}::${s.title}`));
	const reportRuns = allCached.filter((r) => songSet.has(`${r.song.artist}::${r.song.title}`));

	const variantOrder = PROMPT_VARIANTS.map((v) => v.id);
	reportRuns.sort((a, b) => {
		const aIdx = variantOrder.indexOf(a.variantId);
		const bIdx = variantOrder.indexOf(b.variantId);
		return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
	});

	const variantNames = new Map<string, string>();
	for (const r of reportRuns) variantNames.set(r.variantId, r.variantName);

	const html = generateReport(reportRuns, variantNames, cliArgs.songs);
	writeFileSync(cliArgs.outputPath, html, "utf-8");

	const relativeOutput = cliArgs.outputPath.replace(join(__dirname, "../../"), "");
	const variantCount = variantNames.size;
	const songCount = new Set(reportRuns.map((r) => `${r.song.artist}::${r.song.title}`)).size;

	console.log();
	console.log(`${colors.green}\u2192 Report written to ${relativeOutput}${colors.reset}`);
	console.log(`  ${variantCount} variants \u00d7 ${songCount} songs = ${reportRuns.length} analyses`);

	if (totalTokens > 0) {
		console.log(`  Total tokens (new calls): ${formatTokenCount(totalTokens)}`);
	}
	console.log();
}

main().catch((error) => {
	console.error(`${colors.red}Fatal error:${colors.reset}`, error);
	process.exit(1);
});

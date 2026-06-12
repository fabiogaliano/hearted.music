#!/usr/bin/env bun
/// <reference types="bun" />

/**
 * Regenerates the landing-page song fixtures in the current { read } (SongRead) shape
 * using the production v17 lyrical prompt, run through the local `claude` CLI (no API key).
 *
 * Why the CLI instead of the in-app LlmService: this is a one-off content job for the
 * marketing hero, so it rides your Claude Code auth rather than wiring up Vertex/Gemini.
 * It deliberately mirrors SongAnalysisService.buildPrompt slot-for-slot — same template,
 * same pre-legended lyrics, same audio-features formatting — so the read it produces is
 * the same shape SongReadSchema validates in production. No DB writes, no rewrite pass.
 *
 * Inputs (lyrics via Genius, audio features via ReccoBeats) are fetched and cached by the
 * existing prompt-lab DataFetcher; genres come from the curated landing manifest so the
 * grounding the model sees matches what the hero displays.
 *
 * Usage:
 *   bun scripts/landing/regenerate-read.ts                       # all 20 songs
 *   bun scripts/landing/regenerate-read.ts --only 2MvvoeRt8NcOXWESkxWn3g
 *   bun scripts/landing/regenerate-read.ts --limit 1 --model opus
 *   bun scripts/landing/regenerate-read.ts --concurrency 4
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getLyricalPrompt } from "@/lib/domains/enrichment/content-analysis/prompts/registry";
import {
	type SongRead,
	SongReadSchema,
} from "@/lib/domains/enrichment/content-analysis/read-schema";
import { runClaude } from "../voice-audit/tier2/claude-cli";
import { DataFetcher } from "../prompt-lab/data-fetcher";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");
const FIXTURE_DIR = join(REPO_ROOT, "public/landing-songs");
const INDEX_PATH = join(FIXTURE_DIR, "index.json");
const CACHE_DIR = join(__dirname, ".cache");

const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
};

interface ManifestSong {
	id: number;
	spotifyTrackId: string;
	name: string;
	artist: string;
	album: string;
	albumArtUrl: string;
	artistImageUrl?: string;
	spotifyArtistId: string;
	genres: string[];
	detailPath: string;
}

interface CliArgs {
	only: string[] | null;
	limit: number | null;
	model: string;
	concurrency: number;
}

function parseArgs(): CliArgs {
	const args = process.argv.slice(2);
	let only: string[] | null = null;
	let limit: number | null = null;
	let model = "opus";
	let concurrency = 3;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--only") {
			const ids = args[++i].split(",").map((s) => s.trim());
			only = only ? only.concat(ids) : ids;
		} else if (arg === "--limit") {
			limit = Number.parseInt(args[++i], 10);
		} else if (arg === "--model") {
			model = args[++i];
		} else if (arg === "--concurrency") {
			concurrency = Number.parseInt(args[++i], 10);
		} else {
			console.error(`${colors.red}Unknown argument: ${arg}${colors.reset}`);
			process.exit(1);
		}
	}

	return { only, limit, model, concurrency };
}

// Mirror of SongAnalysisService.buildPrompt: same template, same single-replace per slot,
// same order. Genres come from the manifest (curated) rather than Last.fm so the words the
// model grounds texture in match what the hero shows. {example}/{annotations} stay empty —
// the landing job runs without the leave-one-out gold or the vote-gated notes the prod
// pipeline can assemble. Replacement uses a function form so a `$` in lyrics is literal.
function buildPrompt(
	song: ManifestSong,
	lyricsWithLegend: string,
	audioFeaturesFormatted: string,
): string {
	const genres = song.genres.length > 0 ? song.genres.join(", ") : "Unknown";
	return getLyricalPrompt()
		.template.replace("{artist}", () => song.artist)
		.replace("{title}", () => song.name)
		.replace("{genres}", () => genres)
		.replace("{lyrics}", () => lyricsWithLegend)
		.replace("{audio_features}", () => audioFeaturesFormatted)
		.replace("{example}", "")
		.replace("{annotations}", "");
}

// The CLI returns the assistant's text, not a schema-enforced object, so the JSON may arrive
// bare, fenced in ```json, or wrapped in a sentence. Pull the outermost {...} and parse that.
function extractJson(text: string): unknown {
	const trimmed = text.trim();
	const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fence ? fence[1].trim() : trimmed;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end === -1 || end < start) {
		throw new Error("no JSON object found in CLI output");
	}
	return JSON.parse(candidate.slice(start, end + 1));
}

// The prompt asks for explicit nulls on contradiction/texture, but the CLI isn't schema-bound,
// so a draw occasionally omits the key entirely. Coerce a missing nullable to null before Zod
// rather than burn a full re-draw on it; everything else stays strict so a malformed read fails.
function normalizeRead(raw: unknown): unknown {
	if (raw && typeof raw === "object") {
		const obj = raw as Record<string, unknown>;
		if (!("contradiction" in obj)) obj.contradiction = null;
		if (!("texture" in obj)) obj.texture = null;
	}
	return raw;
}

const PARSE_ATTEMPTS = 3;

async function generateRead(
	song: ManifestSong,
	lyricsWithLegend: string,
	audioFeaturesFormatted: string,
	model: string,
): Promise<SongRead> {
	const prompt = buildPrompt(song, lyricsWithLegend, audioFeaturesFormatted);
	let lastErr: unknown;
	// runClaude already retries transient CLI failures; this outer loop covers the parse/validate
	// layer it can't see — a fenced-but-truncated draw or a SongRead floor miss clears on a resample.
	for (let attempt = 1; attempt <= PARSE_ATTEMPTS; attempt++) {
		const { text } = await runClaude(prompt, { model, timeoutMs: 300_000 });
		try {
			return SongReadSchema.parse(normalizeRead(extractJson(text)));
		} catch (err) {
			lastErr = err;
			console.error(
				`    ${colors.yellow}parse/validate attempt ${attempt}/${PARSE_ATTEMPTS} failed (${String((err as Error)?.message ?? err).slice(0, 100)})${colors.reset}`,
			);
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function processSong(
	song: ManifestSong,
	fetcher: DataFetcher,
	model: string,
): Promise<{ trackId: string; ok: boolean; error?: string }> {
	const label = `${song.artist} — ${song.name}`;
	try {
		const data = await fetcher.fetchSongData({
			artist: song.artist,
			title: song.name,
			spotifyTrackId: song.spotifyTrackId,
			album: song.album,
		});

		if (!data.lyrics) {
			throw new Error(
				`no lyrics fetched (${data.errors.join("; ") || "unknown"}) — landing songs must be lyrical`,
			);
		}

		const read = await generateRead(
			song,
			data.lyrics,
			data.audioFeaturesFormatted,
			model,
		);

		const detailPath = join(FIXTURE_DIR, `${song.spotifyTrackId}.json`);
		if (!existsSync(detailPath)) {
			throw new Error(`existing detail file missing: ${detailPath}`);
		}
		const existing = JSON.parse(readFileSync(detailPath, "utf-8")) as Record<
			string,
			unknown
		>;
		// Add `read` alongside whatever is there; the old `analysis` is stripped only once the
		// landing components render `read` (keeps the page working between this run and the wire-up).
		const next = { ...existing, read };
		writeFileSync(detailPath, `${JSON.stringify(next, null, 2)}\n`);

		console.log(
			`  ${colors.green}✓${colors.reset} ${label} ${colors.dim}(lens: ${read.lens})${colors.reset}`,
		);
		return { trackId: song.spotifyTrackId, ok: true };
	} catch (err) {
		const message = (err as Error)?.message ?? String(err);
		console.log(`  ${colors.red}✗ ${label} — ${message}${colors.reset}`);
		return { trackId: song.spotifyTrackId, ok: false, error: message };
	}
}

async function runPool<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<unknown>,
): Promise<void> {
	let cursor = 0;
	const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor++;
			await worker(items[index]);
		}
	});
	await Promise.all(runners);
}

async function main(): Promise<void> {
	const cli = parseArgs();

	const index = JSON.parse(readFileSync(INDEX_PATH, "utf-8")) as {
		generatedAt: string;
		songs: ManifestSong[];
	};

	let songs = index.songs;
	if (cli.only) songs = songs.filter((s) => cli.only!.includes(s.spotifyTrackId));
	if (cli.limit != null) songs = songs.slice(0, cli.limit);

	if (songs.length === 0) {
		console.error(`${colors.red}No songs matched the filter.${colors.reset}`);
		process.exit(1);
	}

	console.log();
	console.log(
		`${colors.cyan}Regenerating ${songs.length} landing read(s) via claude -p (${cli.model}), concurrency ${cli.concurrency}${colors.reset}`,
	);
	console.log(`${colors.dim}Prompt: lyrical v${getLyricalPrompt().version} · schema: SongRead · no rewrite pass${colors.reset}`);
	console.log();

	const fetcher = new DataFetcher({ useCache: true, cacheDir: CACHE_DIR });

	const results: Array<{ trackId: string; ok: boolean; error?: string }> = [];
	await runPool(songs, cli.concurrency, async (song) => {
		results.push(await processSong(song, fetcher, cli.model));
	});

	const failed = results.filter((r) => !r.ok);
	console.log();
	console.log(
		`${colors.cyan}Done: ${results.length - failed.length}/${results.length} succeeded${colors.reset}`,
	);
	if (failed.length > 0) {
		console.log(`${colors.red}Failed:${colors.reset}`);
		for (const f of failed) console.log(`  ${f.trackId}: ${f.error}`);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(`${colors.red}Fatal:${colors.reset}`, error);
	process.exit(1);
});

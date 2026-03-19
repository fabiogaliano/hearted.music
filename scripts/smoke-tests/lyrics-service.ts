#!/usr/bin/env bun
/**
 * Smoke Test: Lyrics Service
 *
 * Verifies the LyricsService (Genius integration) works correctly against the real API.
 * Tests search strategy, lyrics fetching, parsing, and annotation transformation.
 *
 * Usage:
 *   bun scripts/smoke-tests/lyrics-service.ts
 *   bun scripts/smoke-tests/lyrics-service.ts --debug
 *   DEBUG_LYRICS_SEARCH=true bun scripts/smoke-tests/lyrics-service.ts
 *
 * Prerequisites:
 *   - GENIUS_CLIENT_TOKEN in .env
 */

import { Result } from "better-result";
import {
	LyricsService,
	GeniusNotFoundError,
	GeniusParseError,
	GeniusFetchError,
} from "@/lib/domains/enrichment/lyrics/service";
import {
	generateQueryVariants,
	scoreResult,
} from "@/lib/domains/enrichment/lyrics/utils/search-strategy";
import { calculateSimilarity } from "@/lib/domains/enrichment/lyrics/utils/string-similarity";
import type { ResponseHitsResult } from "@/lib/domains/enrichment/lyrics/types/genius.types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
};

function log(icon: string, message: string) {
	console.log(`${icon} ${message}`);
}

function success(message: string) {
	log(`${colors.green}✓${colors.reset}`, message);
}

function fail(message: string) {
	log(`${colors.red}✗${colors.reset}`, message);
}

function info(message: string) {
	log(`${colors.cyan}→${colors.reset}`, message);
}

function dim(message: string) {
	console.log(`  ${colors.dim}${message}${colors.reset}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Data
// ─────────────────────────────────────────────────────────────────────────────

interface TestSong {
	artist: string;
	title: string;
	expectedMatch?: string; // Expected Genius title if different
	shouldFail?: boolean;
}

// Well-known songs that should reliably match on Genius
const TEST_SONGS: TestSong[] = [
	// Simple cases
	{ artist: "The Weeknd", title: "Blinding Lights" },
	{ artist: "Daft Punk", title: "Get Lucky" },

	// With featured artist
	{
		artist: "Kendrick Lamar",
		title: "All The Stars (feat. SZA)",
		expectedMatch: "All The Stars",
	},

	// With dash suffix (should be stripped)
	{
		artist: "The Weeknd",
		title: "Blinding Lights - Radio Edit",
		expectedMatch: "Blinding Lights",
	},

	// Edge case - unlikely to find
	{
		artist: "ZZZZZ_FAKE_ARTIST",
		title: "ZZZZZ_FAKE_SONG_12345",
		shouldFail: true,
	},
];

// ─────────────────────────────────────────────────────────────────────────────
// Test Cases
// ─────────────────────────────────────────────────────────────────────────────

interface TestResult {
	name: string;
	passed: boolean;
	details?: string;
}

async function runTests(): Promise<TestResult[]> {
	const results: TestResult[] = [];

	// Check for token
	const token = process.env.GENIUS_CLIENT_TOKEN;
	if (!token) {
		fail("GENIUS_CLIENT_TOKEN not set in environment");
		dim("Add it to your .env file: GENIUS_CLIENT_TOKEN=your_token");
		dim("Get a token at: https://genius.com/api-clients");
		process.exit(1);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test 1: Query Variant Generation
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Testing generateQueryVariants()...");

	const variants = generateQueryVariants(
		"Kendrick Lamar",
		"All The Stars (feat. SZA)",
	);

	if (variants[0] === "Kendrick Lamar All The Stars") {
		success("Clean title variant generated first");
		dim(`Variants: ${variants.slice(0, 3).join(" | ")}...`);
		results.push({ name: "queryVariants", passed: true, details: `${variants.length} variants` });
	} else {
		fail(`Expected clean title first, got: ${variants[0]}`);
		results.push({ name: "queryVariants", passed: false, details: variants[0] });
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test 2: String Similarity
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Testing calculateSimilarity()...");

	const exactMatch = calculateSimilarity("Blinding Lights", "Blinding Lights");
	const caseMatch = calculateSimilarity("BLINDING LIGHTS", "blinding lights");
	const partialMatch = calculateSimilarity("Blinding Lights", "Blinding");

	if (exactMatch === 1 && caseMatch === 1 && partialMatch > 0.8) {
		success("String similarity working correctly");
		dim(`Exact: ${exactMatch}, Case-insensitive: ${caseMatch}, Partial: ${partialMatch.toFixed(2)}`);
		results.push({ name: "stringSimilarity", passed: true });
	} else {
		fail("String similarity not working as expected");
		results.push({ name: "stringSimilarity", passed: false });
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test 3: Result Scoring
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Testing scoreResult() with 55/45 weighting...");

	const mockResult = {
		id: 1,
		url: "https://genius.com/test",
		title: "Blinding Lights",
		primary_artist: { name: "The Weeknd" },
		primary_artists: [{ name: "The Weeknd" }],
		featured_artists: [],
	} as unknown as ResponseHitsResult;

	const score = scoreResult(mockResult, "The Weeknd", "Blinding Lights");

	if (score.score > 0.95 && score.titleScore > 0.9 && score.artistScore > 0.9) {
		success(`Scoring works: combined=${(score.score * 100).toFixed(0)}%`);
		dim(`Title: ${(score.titleScore * 100).toFixed(0)}%, Artist: ${(score.artistScore * 100).toFixed(0)}%`);
		results.push({ name: "resultScoring", passed: true });
	} else {
		fail(`Score too low: ${score.score}`);
		results.push({ name: "resultScoring", passed: false, details: `${score.score}` });
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test 4: Initialize LyricsService
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Initializing LyricsService...");

	let service: LyricsService;
	try {
		service = new LyricsService({ accessToken: token });
		success("LyricsService initialized");
		results.push({ name: "serviceInit", passed: true });
	} catch (error) {
		fail(`Failed to initialize: ${error}`);
		results.push({ name: "serviceInit", passed: false });
		return results; // Can't continue
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test 5-N: Fetch Lyrics for Test Songs
	// ─────────────────────────────────────────────────────────────────────────
	for (const song of TEST_SONGS) {
		console.log("");
		info(`Testing getLyrics("${song.artist}", "${song.title}")...`);

		const lyricsResult = await service.getLyrics(song.artist, song.title);
		if (Result.isOk(lyricsResult)) {
			const sections = lyricsResult.value;
			if (song.shouldFail) {
				fail(`Expected to fail but got ${sections.length} sections`);
				results.push({
					name: `lyrics:${song.artist}`,
					passed: false,
					details: "Expected failure",
				});
				continue;
			}
			const totalLines = sections.reduce((sum, s) => sum + s.lines.length, 0);
			success(`Got ${sections.length} sections, ${totalLines} lines`);

			// Show first section preview
			if (sections.length > 0) {
				const firstSection = sections[0];
				const preview = firstSection.lines[0]?.text.slice(0, 50) ?? "(empty)";
				dim(`[${firstSection.type}] "${preview}..."`);

				// Check for annotations
				const annotationCount = sections.reduce(
					(sum, s) => sum + s.lines.filter((l) => l.annotations?.length).length,
					0,
				);
				if (annotationCount > 0) {
					dim(`📝 ${annotationCount} lines with annotations`);
				}
			}

			results.push({
				name: `lyrics:${song.artist}`,
				passed: true,
				details: `${totalLines} lines`,
			});
			continue;
		}

		const error = lyricsResult.error;
		if (song.shouldFail) {
			if (error instanceof GeniusNotFoundError) {
				success("Correctly returned GeniusNotFoundError");
				results.push({ name: `lyrics:${song.artist}`, passed: true, details: "Expected failure" });
			} else {
				fail(`Wrong error type: ${error}`);
				results.push({ name: `lyrics:${song.artist}`, passed: false, details: "Wrong error" });
			}
		} else {
			const errorType =
				error instanceof GeniusNotFoundError
					? "NOT_FOUND"
					: error instanceof GeniusParseError
						? "PARSE_ERROR"
							: error instanceof GeniusFetchError
								? "FETCH_ERROR"
								: "UNKNOWN";
			fail(`Failed (${errorType}): ${error}`);
			results.push({ name: `lyrics:${song.artist}`, passed: false, details: errorType });
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test: getLyricsText (plain text output)
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Testing getLyricsText() for pipeline integration...");

	const textResult = await service.getLyricsText("The Weeknd", "Blinding Lights");
	if (Result.isOk(textResult)) {
		const text = textResult.value;
		if (text && text.length > 100) {
			success(`Got ${text.length} chars of annotated lyrics text`);
			dim(`Preview: "${text.slice(0, 60).replace(/\n/g, " ")}..."`);
			results.push({ name: "getLyricsText", passed: true, details: `${text.length} chars` });
		} else {
			fail("Text too short");
			results.push({ name: "getLyricsText", passed: false, details: `${text?.length ?? 0} chars` });
		}
	} else {
		fail(`getLyricsText failed: ${textResult.error}`);
		results.push({ name: "getLyricsText", passed: false });
	}

	return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║         🎤 Lyrics Service Smoke Test                       ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);

	// Enable debug mode if requested
	if (process.argv.includes("--debug")) {
		process.env.DEBUG_LYRICS_SEARCH = "true";
		dim("Debug mode enabled (verbose search logging)");
	}

	const results = await runTests();

	// Summary
	console.log(`
${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}
`);

	const passed = results.filter((r) => r.passed).length;
	const total = results.length;

	if (passed === total) {
		console.log(`${colors.green}🎯 All ${total} tests passed!${colors.reset}`);
		console.log(`${colors.dim}   The lyrics service is working correctly.${colors.reset}`);
	} else {
		console.log(`${colors.yellow}⚠️  ${passed}/${total} tests passed${colors.reset}`);
		console.log("");
		for (const r of results.filter((r) => !r.passed)) {
			console.log(`   ${colors.red}✗${colors.reset} ${r.name}: ${r.details ?? "failed"}`);
		}
	}

	console.log("");
	process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
	console.error("Full error:", err);
	fail(`Unexpected error: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
	process.exit(1);
});

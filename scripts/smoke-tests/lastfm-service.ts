#!/usr/bin/env bun
/**
 * Smoke Test: Last.fm Service
 *
 * Verifies LastFmService works against the real Last.fm API.
 * Tests genre tag lookups with album -> artist fallback chain.
 *
 * Usage:
 *   bun scripts/smoke-tests/lastfm-service.ts
 *
 * Prerequisites:
 *   - Valid .env with LASTFM_API_KEY
 */

import { Result, matchError } from "better-result";
import { createLastFmService, LastFmService } from "@/lib/integrations/lastfm/service";
import type { LastFmError } from "@/lib/shared/errors/external/lastfm";

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

function formatError(error: LastFmError): string {
	return matchError(error, {
		LastFmRateLimitError: () => "Rate limited",
		LastFmApiError: (e) => `API error ${e.code}: ${e.reason}`,
		LastFmConfigError: (e) => `Config error: ${e.reason}`,
		LastFmNotFoundError: (e) => `Not found: ${e.artist}`,
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Data
// ─────────────────────────────────────────────────────────────────────────────

const TEST_CASES = {
	// Well-known albums/artists with reliable genre tags
	albumWithTags: {
		artist: "Radiohead",
		album: "OK Computer",
		track: "Paranoid Android",
	},
	artistWithTags: {
		artist: "Daft Punk",
	},
	obscureArtist: {
		artist: "Unknown Artist 12345xyz",
		album: "Unknown Album",
		track: "Unknown Track",
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Test Cases
// ─────────────────────────────────────────────────────────────────────────────

interface TestResult {
	name: string;
	passed: boolean;
	details?: string;
}

async function runTests(service: LastFmService): Promise<TestResult[]> {
	const results: TestResult[] = [];

	// Test 1: Get Album Top Tags
	console.log("");
	info(`Testing getAlbumTopTags("${TEST_CASES.albumWithTags.artist}", "${TEST_CASES.albumWithTags.album}")...`);

	const albumResult = await service.getAlbumTopTags(
		TEST_CASES.albumWithTags.artist,
		TEST_CASES.albumWithTags.album,
	);

	if (Result.isOk(albumResult)) {
		if (albumResult.value) {
			success(`Got ${albumResult.value.tags.length} tags from album`);
			dim(`Tags: ${albumResult.value.tags.join(", ")}`);
			dim(`Source: ${albumResult.value.sourceLevel}`);
			results.push({ name: "getAlbumTopTags", passed: true, details: albumResult.value.tags.join(", ") });
		} else {
			fail("getAlbumTopTags returned null (no tags found)");
			results.push({ name: "getAlbumTopTags", passed: false, details: "No tags returned" });
		}
	} else {
		fail(`getAlbumTopTags failed: ${formatError(albumResult.error)}`);
		results.push({ name: "getAlbumTopTags", passed: false, details: formatError(albumResult.error) });
	}

	// Test 2: Get Artist Top Tags
	console.log("");
	info(`Testing getArtistTopTags("${TEST_CASES.artistWithTags.artist}")...`);

	const artistResult = await service.getArtistTopTags(TEST_CASES.artistWithTags.artist);

	if (Result.isOk(artistResult)) {
		if (artistResult.value) {
			success(`Got ${artistResult.value.tags.length} tags from artist`);
			dim(`Tags: ${artistResult.value.tags.join(", ")}`);
			dim(`Source: ${artistResult.value.sourceLevel}`);
			results.push({ name: "getArtistTopTags", passed: true, details: artistResult.value.tags.join(", ") });
		} else {
			fail("getArtistTopTags returned null (no tags found)");
			results.push({ name: "getArtistTopTags", passed: false, details: "No tags returned" });
		}
	} else {
		fail(`getArtistTopTags failed: ${formatError(artistResult.error)}`);
		results.push({ name: "getArtistTopTags", passed: false, details: formatError(artistResult.error) });
	}

	// Test 3: Fallback Chain
	console.log("");
	info(`Testing getTagsWithFallback() with album...`);

	const fallbackResult = await service.getTagsWithFallback(
		TEST_CASES.albumWithTags.artist,
		TEST_CASES.albumWithTags.track,
		TEST_CASES.albumWithTags.album,
	);

	if (Result.isOk(fallbackResult)) {
		if (fallbackResult.value) {
			success(`Fallback chain returned tags from ${fallbackResult.value.sourceLevel}`);
			dim(`Tags: ${fallbackResult.value.tags.join(", ")}`);
			results.push({ name: "getTagsWithFallback (album)", passed: true, details: `from ${fallbackResult.value.sourceLevel}` });
		} else {
			fail("Fallback chain returned null");
			results.push({ name: "getTagsWithFallback (album)", passed: false, details: "No tags" });
		}
	} else {
		fail(`Fallback failed: ${formatError(fallbackResult.error)}`);
		results.push({ name: "getTagsWithFallback (album)", passed: false, details: formatError(fallbackResult.error) });
	}

	// Test 4: Obscure lookup (should gracefully return null)
	console.log("");
	info(`Testing getTagsWithFallback() with unknown artist...`);

	const obscureResult = await service.getTagsWithFallback(
		TEST_CASES.obscureArtist.artist,
		TEST_CASES.obscureArtist.track,
		TEST_CASES.obscureArtist.album,
	);

	if (Result.isOk(obscureResult)) {
		if (obscureResult.value === null) {
			success("Correctly returned null for unknown artist");
			results.push({ name: "getTagsWithFallback (unknown)", passed: true, details: "null as expected" });
		} else {
			// Surprising but not a failure
			success(`Unexpectedly found tags: ${obscureResult.value.tags.join(", ")}`);
			results.push({ name: "getTagsWithFallback (unknown)", passed: true, details: "found tags" });
		}
	} else {
		fail(`Obscure lookup failed: ${formatError(obscureResult.error)}`);
		results.push({ name: "getTagsWithFallback (unknown)", passed: false, details: formatError(obscureResult.error) });
	}

	return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║         🎵 Last.fm Service Smoke Test                     ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);

	// Initialize service
	info("Initializing LastFmService...");

	const serviceResult = createLastFmService();
	if (serviceResult === null) {
		fail("LASTFM_API_KEY not configured in .env");
		dim("Add LASTFM_API_KEY=your_key to .env and try again");
		process.exit(1);
	}

	if (Result.isError(serviceResult)) {
		fail(`Failed to create service: ${serviceResult.error.message}`);
		process.exit(1);
	}

	success("LastFmService initialized");

	const results = await runTests(serviceResult.value);

	// Summary
	console.log(`
${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}
`);

	const passed = results.filter((r) => r.passed).length;
	const total = results.length;

	if (passed === total) {
		console.log(`${colors.green}🎯 All ${total} tests passed!${colors.reset}`);
		console.log(`${colors.dim}   Last.fm API connectivity and parsing working correctly.${colors.reset}`);
	} else {
		console.log(`${colors.yellow}⚠️  ${passed}/${total} tests passed${colors.reset}`);
		console.log("");
		for (const r of results.filter((r) => !r.passed)) {
			console.log(`   ${colors.red}✗${colors.reset} ${r.name}: ${r.details}`);
		}
	}

	console.log("");
	process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
	fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});

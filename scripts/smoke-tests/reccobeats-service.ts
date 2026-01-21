#!/usr/bin/env bun
/**
 * Smoke Test: ReccoBeats Service
 *
 * Verifies ReccoBeatsService works against the real ReccoBeats API.
 * Tests audio features lookups using Spotify track IDs.
 *
 * Usage:
 *   bun scripts/smoke-tests/reccobeats-service.ts
 *
 * Prerequisites:
 *   - Internet connection
 *
 * NOTE: ReccoBeats API status can change - if tests fail, check:
 *   curl -v "https://api.reccobeats.com/v1/spotify/track/3n3Ppam7vgaVa1iaRUc9Lp"
 */

import { Result, matchError } from "better-result";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import type { ReccoBeatsError } from "@/lib/shared/errors/external/reccobeats";

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

function formatError(error: ReccoBeatsError): string {
	return matchError(error, {
		ReccoBeatsRateLimitError: (e) => `Rate limited${e.retryAfterMs ? ` (retry after ${e.retryAfterMs}ms)` : ""}`,
		ReccoBeatsApiError: (e) => `API error ${e.statusCode}: ${e.message}`,
		ReccoBeatsNotFoundError: (e) => `Not found: ${e.spotifyTrackId}`,
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Data
// ─────────────────────────────────────────────────────────────────────────────

// Well-known Spotify track IDs that should exist in ReccoBeats
const TEST_TRACKS = {
	// "Bohemian Rhapsody" by Queen - classic, definitely in ReccoBeats
	bohemianRhapsody: "4u7EnebtmKWzUH433cf5Qv",
	// "Blinding Lights" by The Weeknd - popular recent track
	blindingLights: "0VjIjW4GlUZAMYd2vXMi3b",
	// "Shape of You" by Ed Sheeran
	shapeOfYou: "7qiZfU4dY1lWllzX7mPBI3",
	// Invalid ID to test error handling
	invalidId: "notarealspotifyid12345",
};

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
	const service = createReccoBeatsService();

	// Test 1: Single track lookup
	console.log("");
	info(`Testing getAudioFeatures("${TEST_TRACKS.bohemianRhapsody}")...`);
	dim("Track: Bohemian Rhapsody - Queen");

	const singleResult = await service.getAudioFeatures(TEST_TRACKS.bohemianRhapsody);

	if (Result.isOk(singleResult)) {
		if (singleResult.value) {
			success("Got audio features");
			dim(`energy: ${singleResult.value.energy.toFixed(3)}, valence: ${singleResult.value.valence.toFixed(3)}, danceability: ${singleResult.value.danceability.toFixed(3)}`);
			dim(`tempo: ${singleResult.value.tempo.toFixed(1)} BPM`);
			results.push({ name: "getAudioFeatures (single)", passed: true });
		} else {
			fail("Track not found in ReccoBeats");
			results.push({ name: "getAudioFeatures (single)", passed: false, details: "Track not found" });
		}
	} else {
		fail(`getAudioFeatures failed: ${formatError(singleResult.error)}`);
		results.push({ name: "getAudioFeatures (single)", passed: false, details: formatError(singleResult.error) });
	}

	// Test 2: Batch lookup
	console.log("");
	const batchIds = [TEST_TRACKS.bohemianRhapsody, TEST_TRACKS.blindingLights, TEST_TRACKS.shapeOfYou];
	info(`Testing getAudioFeaturesBatch() with ${batchIds.length} tracks...`);

	const batchResult = await service.getAudioFeaturesBatch(batchIds);

	if (Result.isOk(batchResult)) {
		const { features, stats } = batchResult.value;
		success(`Batch returned ${stats.succeeded}/${stats.total} tracks`);

		for (const [id, f] of features) {
			const trackName = id === TEST_TRACKS.bohemianRhapsody ? "Bohemian Rhapsody" :
				id === TEST_TRACKS.blindingLights ? "Blinding Lights" : "Shape of You";
			dim(`${trackName}: energy=${f.energy.toFixed(2)}, valence=${f.valence.toFixed(2)}`);
		}

		// Consider passed if at least 2/3 tracks found (some might be missing from ReccoBeats)
		const passed = stats.succeeded >= 2;
		results.push({
			name: "getAudioFeaturesBatch",
			passed,
			details: `${stats.succeeded}/${stats.total}`,
		});
	} else {
		fail(`Batch failed: ${formatError(batchResult.error)}`);
		results.push({ name: "getAudioFeaturesBatch", passed: false, details: formatError(batchResult.error) });
	}

	// Test 3: Invalid ID handling (should return null, not error)
	console.log("");
	info(`Testing getAudioFeatures() with invalid ID...`);

	const invalidResult = await service.getAudioFeatures(TEST_TRACKS.invalidId);

	if (Result.isOk(invalidResult)) {
		if (invalidResult.value === null) {
			success("Correctly returned null for invalid ID");
			results.push({ name: "getAudioFeatures (invalid)", passed: true, details: "null as expected" });
		} else {
			fail("Unexpectedly returned features for invalid ID");
			results.push({ name: "getAudioFeatures (invalid)", passed: false, details: "Got features for invalid ID" });
		}
	} else {
		// 404 should be converted to null, so this is unexpected
		fail(`Invalid ID lookup errored instead of returning null: ${formatError(invalidResult.error)}`);
		results.push({ name: "getAudioFeatures (invalid)", passed: false, details: formatError(invalidResult.error) });
	}

	// Test 4: Verify response shape
	console.log("");
	info("Testing response shape validation...");

	if (Result.isOk(singleResult) && singleResult.value) {
		const features = singleResult.value;
		const expectedFields = ["acousticness", "danceability", "energy", "instrumentalness", "liveness", "speechiness", "valence", "tempo", "loudness"];
		const missingFields = expectedFields.filter((f) => !(f in features));

		if (missingFields.length === 0) {
			success("All expected audio feature fields present");
			results.push({ name: "response shape", passed: true });
		} else {
			fail(`Missing fields: ${missingFields.join(", ")}`);
			results.push({ name: "response shape", passed: false, details: `Missing: ${missingFields.join(", ")}` });
		}
	} else {
		dim("Skipped (no features to validate)");
		results.push({ name: "response shape", passed: true, details: "skipped" });
	}

	return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║         🎧 ReccoBeats Service Smoke Test                  ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);

	// Quick API health check using correct endpoint
	info("Checking ReccoBeats API status...");
	try {
		const testUrl = "https://api.reccobeats.com/v1/track?ids=3n3Ppam7vgaVa1iaRUc9Lp";
		const response = await fetch(testUrl);
		if (response.status === 429) {
			fail("ReccoBeats API rate limited");
			process.exit(1);
		} else if (response.ok) {
			success("ReccoBeats API is accessible");
		} else {
			fail(`ReccoBeats API returned unexpected status: ${response.status}`);
			dim(`Debug: curl -v "${testUrl}"`);
			process.exit(1);
		}
	} catch (err) {
		fail(`Cannot reach ReccoBeats API: ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}
	console.log("");

	const results = await runTests();

	// Summary
	console.log(`
${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}
`);

	const passed = results.filter((r) => r.passed).length;
	const total = results.length;

	if (passed === total) {
		console.log(`${colors.green}🎯 All ${total} tests passed!${colors.reset}`);
		console.log(`${colors.dim}   ReccoBeats API connectivity and parsing working correctly.${colors.reset}`);
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

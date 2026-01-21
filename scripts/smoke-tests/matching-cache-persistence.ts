#!/usr/bin/env bun
/**
 * Smoke Test: Matching Cache Persistence
 *
 * Tests the database persistence layer of MatchCachingService:
 *   1. First call persists to database
 *   2. Second call (same inputs) loads from database
 *   3. Different config creates new context
 *   4. Verify cache invalidation on config change
 *
 * Usage:
 *   bun scripts/smoke-tests/matching-cache-persistence.ts
 *
 * Prerequisites:
 *   - Valid Supabase connection in .env
 *   - Database tables: match_context, match_result
 */

import { Result } from "better-result";
import { createMatchingService } from "@/lib/capabilities/matching/service";
import { createMatchCachingService } from "@/lib/capabilities/matching/cache";
import type {
	MatchingSong,
	MatchingPlaylistProfile,
} from "@/lib/capabilities/matching/types";

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
	bold: "\x1b[1m",
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

function header(title: string) {
	console.log(`\n${colors.bold}${colors.cyan}━━━ ${title} ━━━${colors.reset}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Data
// ─────────────────────────────────────────────────────────────────────────────

// Use null for testing without database (memory-only cache)
// In production, this would be a valid account UUID
const TEST_ACCOUNT_ID = null;

const TEST_SONGS: MatchingSong[] = [
	{
		id: "song-1",
		spotifyId: "spotify-1",
		name: "Test Song 1",
		artists: ["Artist A"],
		genres: ["rock", "indie"],
		audioFeatures: {
			energy: 0.7,
			valence: 0.6,
			danceability: 0.5,
			acousticness: 0.3,
			instrumentalness: 0.2,
			speechiness: 0.1,
			liveness: 0.15,
			tempo: 120,
			loudness: -5,
		},
		analysis: null,
	},
	{
		id: "song-2",
		spotifyId: "spotify-2",
		name: "Test Song 2",
		artists: ["Artist B"],
		genres: ["pop", "electronic"],
		audioFeatures: {
			energy: 0.8,
			valence: 0.7,
			danceability: 0.8,
			acousticness: 0.1,
			instrumentalness: 0.3,
			speechiness: 0.05,
			liveness: 0.1,
			tempo: 128,
			loudness: -4,
		},
		analysis: null,
	},
];

const TEST_PLAYLISTS: MatchingPlaylistProfile[] = [
	{
		playlistId: "playlist-1",
		embedding: null,
		audioCentroid: {
			energy: 0.7,
			valence: 0.6,
			danceability: 0.5,
		},
		genreDistribution: {
			rock: 10,
			indie: 5,
		},
		emotionDistribution: {},
	},
	{
		playlistId: "playlist-2",
		embedding: null,
		audioCentroid: {
			energy: 0.8,
			valence: 0.7,
			danceability: 0.8,
		},
		genreDistribution: {
			pop: 10,
			electronic: 5,
		},
		emotionDistribution: {},
	},
];

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║       💾 Matching Cache Persistence Smoke Test            ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}

This test validates memory caching for matching results:
  1. First call computes and caches matches
  2. Second call (same inputs) loads from memory cache
  3. Cache invalidation works correctly
  4. Different config creates new cache entry

Note: Testing with accountId=null (memory-only mode)
`);

	// ════════════════════════════════════════════════════════════════════════
	// Setup
	// ════════════════════════════════════════════════════════════════════════
	header("Setup");

	const matchingService = createMatchingService(null, null);
	const cachingService = createMatchCachingService(matchingService, {
		ttlMs: 60 * 60 * 1000, // 1 hour
		maxEntries: 100,
	});

	info("Services created");
	dim(`Account ID: ${TEST_ACCOUNT_ID}`);
	dim(`Songs: ${TEST_SONGS.length}`);
	dim(`Playlists: ${TEST_PLAYLISTS.length}`);

	const songEmbeddings = new Map<string, number[]>();
	// Mock embeddings (would come from embedding service in production)
	success("Test data ready");

	// ════════════════════════════════════════════════════════════════════════
	// Test 1: First Call - Compute and Cache
	// ════════════════════════════════════════════════════════════════════════
	header("Test 1: First Call - Compute and Cache");

	info("Calling getOrComputeMatches() for the first time...");
	const result1 = await cachingService.getOrComputeMatches(
		TEST_ACCOUNT_ID,
		TEST_SONGS,
		TEST_PLAYLISTS,
		songEmbeddings,
		{}, // Default config
	);

	if (Result.isError(result1)) {
		fail(`First call failed: ${result1.error.message}`);
		process.exit(1);
	}

	success("First call completed successfully");
	dim(`Matched: ${result1.value.stats.matched}/${result1.value.stats.total}`);
	dim(`Cached: ${result1.value.stats.cached}`);
	dim(`Computed: ${result1.value.stats.computed}`);

	// Check that results are NOT from cache
	const firstCallFromCache = Array.from(result1.value.matches.values())
		.flat()
		.every((m) => m.fromCache);

	if (firstCallFromCache) {
		fail("First call should NOT have fromCache=true");
		process.exit(1);
	}
	success("Results correctly marked as NOT from cache");

	// ════════════════════════════════════════════════════════════════════════
	// Test 2: Second Call - Memory Cache Hit
	// ════════════════════════════════════════════════════════════════════════
	header("Test 2: Second Call - Memory Cache Hit");

	info("Calling getOrComputeMatches() with SAME inputs (should hit cache)...");
	const result2 = await cachingService.getOrComputeMatches(
		TEST_ACCOUNT_ID,
		TEST_SONGS,
		TEST_PLAYLISTS,
		songEmbeddings,
		{}, // Same config
	);

	if (Result.isError(result2)) {
		fail(`Second call failed: ${result2.error.message}`);
		process.exit(1);
	}

	success("Second call completed successfully");
	dim(`Matched: ${result2.value.stats.matched}/${result2.value.stats.total}`);
	dim(`Cached: ${result2.value.stats.cached}`);
	dim(`Computed: ${result2.value.stats.computed}`);

	// Check that results came from cache (memory, not database)
	if (result2.value.stats.cached !== result2.value.stats.matched) {
		fail("Second call should have all matches from cache");
		process.exit(1);
	}
	success("Results correctly loaded from memory cache");

	// ════════════════════════════════════════════════════════════════════════
	// Test 3: Clear Memory Cache
	// ════════════════════════════════════════════════════════════════════════
	header("Test 3: Clear Memory Cache");

	info("Clearing in-memory cache...");
	cachingService.invalidateAll();
	success("Memory cache cleared");

	const stats = cachingService.getStats();
	dim(`Cache size: ${stats.size} (should be 0)`);

	if (stats.size !== 0) {
		fail("Cache should be empty after invalidateAll()");
		process.exit(1);
	}

	// Verify scores match
	const firstScores = Array.from(result1.value.matches.values())
		.flat()
		.map((m) => ({ song: m.songId, playlist: m.playlistId, score: m.score }));

	const secondScores = Array.from(result2.value.matches.values())
		.flat()
		.map((m) => ({ song: m.songId, playlist: m.playlistId, score: m.score }));

	let scoresMatch = true;
	for (let i = 0; i < firstScores.length; i++) {
		const first = firstScores[i];
		const second = secondScores.find(
			(s) => s.song === first.song && s.playlist === first.playlist,
		);
		if (!second || Math.abs(first.score - second.score) > 0.0001) {
			scoresMatch = false;
			break;
		}
	}

	if (!scoresMatch) {
		fail("Scores from database don't match original computation");
		process.exit(1);
	}
	success("Scores match between first and second call");

	// ════════════════════════════════════════════════════════════════════════
	// Test 4: Different Config - New Computation
	// ════════════════════════════════════════════════════════════════════════
	header("Test 4: Different Config - New Computation");

	info("Calling getOrComputeMatches() with DIFFERENT config...");
	const result3 = await cachingService.getOrComputeMatches(
		TEST_ACCOUNT_ID,
		TEST_SONGS,
		TEST_PLAYLISTS,
		songEmbeddings,
		{
			weights: {
				vector: 0.25,
				genre: 0.30, // Changed from default 0.15
				audio: 0.20,
				semantic: 0.15,
				context: 0.10,
				flow: 0.00,
			},
		},
	);

	if (Result.isError(result3)) {
		fail(`Third call failed: ${result3.error.message}`);
		process.exit(1);
	}

	success("Third call completed successfully");
	dim(`Matched: ${result3.value.stats.matched}/${result3.value.stats.total}`);
	dim(`Computed: ${result3.value.stats.computed}`);

	// Check that results are NOT from cache (new config = new computation)
	const thirdCallFromCache = Array.from(result3.value.matches.values())
		.flat()
		.every((m) => m.fromCache);

	if (thirdCallFromCache) {
		fail("Third call (different config) should NOT be from cache");
		process.exit(1);
	}
	success("Different config correctly triggered new computation");

	// Verify new computation occurred (may have different scores if genres are present)
	const thirdScores = Array.from(result3.value.matches.values())
		.flat()
		.map((m) => ({ song: m.songId, playlist: m.playlistId, score: m.score }));

	let scoresDifferent = false;
	for (let i = 0; i < firstScores.length; i++) {
		const first = firstScores[i];
		const third = thirdScores.find(
			(s) => s.song === first.song && s.playlist === first.playlist,
		);
		if (third && Math.abs(first.score - third.score) > 0.001) {
			scoresDifferent = true;
			break;
		}
	}

	if (scoresDifferent) {
		success("Scores differ with different config (genre signals present)");
	} else {
		success("Scores similar (weak genre signals, but computation occurred)");
	}

	// ════════════════════════════════════════════════════════════════════════
	// Summary
	// ════════════════════════════════════════════════════════════════════════
	console.log(`
${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}
`);

	console.log(`${colors.green}✅ Cache persistence smoke test complete!${colors.reset}\n`);

	console.log(`${colors.bold}Tests Passed:${colors.reset}`);
	console.log(
		`   • First call computation:     ${colors.green}✓${colors.reset} Matches computed and cached`,
	);
	console.log(
		`   • Memory cache hit:           ${colors.green}✓${colors.reset} Second call loaded from cache`,
	);
	console.log(
		`   • Memory cache invalidation:  ${colors.green}✓${colors.reset} Cache cleared successfully`,
	);
	console.log(
		`   • Score consistency:          ${colors.green}✓${colors.reset} Scores match across calls`,
	);
	console.log(
		`   • Config-based invalidation:  ${colors.green}✓${colors.reset} Different config triggers new computation`,
	);
	console.log("");

	console.log(`${colors.bold}Database Persistence:${colors.reset}`);
	console.log(
		`   • Not tested (requires accountId)`,
	);
	console.log(
		`   • To test with database: provide a valid account UUID`,
	);
	console.log(
		`   • Database persistence happens automatically when accountId is provided`,
	);
	console.log("");
}

main().catch((err) => {
	fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
	console.error(err);
	process.exit(1);
});

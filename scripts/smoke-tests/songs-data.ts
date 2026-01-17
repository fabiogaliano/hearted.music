#!/usr/bin/env bun
/**
 * Smoke Test: Songs Data Module
 *
 * Verifies the songs.ts data module works correctly against Supabase.
 * Tests CRUD operations for songs, liked songs, and status tracking.
 *
 * Usage:
 *   bun scripts/smoke-tests/songs-data.ts <account-id>
 *   bun scripts/smoke-tests/songs-data.ts --spotify-id <spotify-user-id>
 *   bun scripts/smoke-tests/songs-data.ts --list-accounts
 *
 * Prerequisites:
 *   - Valid .env with Supabase credentials
 *   - At least one account in the database
 */

import { Result } from "better-result";
import { getAccountById, getAccountBySpotifyId } from "@/lib/data/accounts";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	getSongById,
	getSongBySpotifyId,
	getSongsBySpotifyIds,
	upsertSongs,
	getLikedSongs,
	upsertLikedSongs,
	softDeleteLikedSong,
	getPendingLikedSongs,
	updateLikedSongStatus,
	type UpsertSongData,
} from "@/lib/data/songs";

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
// Account Resolution
// ─────────────────────────────────────────────────────────────────────────────

async function listAccounts() {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("account")
		.select("id, spotify_id, display_name, email")
		.order("created_at", { ascending: false })
		.limit(10);

	if (error) {
		fail(`Failed to list accounts: ${error.message}`);
		process.exit(1);
	}

	if (!data?.length) {
		fail("No accounts found. Log in via the app first.");
		process.exit(1);
	}

	console.log("\n📋 Available accounts:\n");
	console.log("  ID                                    | Spotify ID       | Name");
	console.log("  " + "─".repeat(75));
	for (const acc of data) {
		console.log(`  ${acc.id} | ${acc.spotify_id.padEnd(16)} | ${acc.display_name ?? acc.email ?? "unknown"}`);
	}
	console.log("\n  Run with: bun scripts/smoke-tests/songs-data.ts <account-id>\n");
}

async function resolveAccountId(args: string[]): Promise<string> {
	if (args.includes("--list-accounts")) {
		await listAccounts();
		process.exit(0);
	}

	const spotifyIdIndex = args.indexOf("--spotify-id");
	if (spotifyIdIndex !== -1) {
		const spotifyId = args[spotifyIdIndex + 1];
		if (!spotifyId) {
			fail("Missing Spotify ID after --spotify-id");
			process.exit(1);
		}
		const accountResult = await getAccountBySpotifyId(spotifyId);
		if (Result.isError(accountResult)) {
			fail(`Database error: ${accountResult.error.message}`);
			process.exit(1);
		}
		if (!accountResult.value) {
			fail(`No account found for Spotify ID: ${spotifyId}`);
			process.exit(1);
		}
		return accountResult.value.id;
	}

	const accountId = args[0];
	if (!accountId) {
		console.log(`
${colors.yellow}Usage:${colors.reset}
  bun scripts/smoke-tests/songs-data.ts <account-id>
  bun scripts/smoke-tests/songs-data.ts --spotify-id <spotify-user-id>
  bun scripts/smoke-tests/songs-data.ts --list-accounts
`);
		process.exit(1);
	}

	const accountResult = await getAccountById(accountId);
	if (Result.isError(accountResult)) {
		fail(`Database error: ${accountResult.error.message}`);
		process.exit(1);
	}
	if (!accountResult.value) {
		fail(`No account found for ID: ${accountId}`);
		dim("Run with --list-accounts to see available accounts");
		process.exit(1);
	}

	return accountResult.value.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Cases
// ─────────────────────────────────────────────────────────────────────────────

interface TestResult {
	name: string;
	passed: boolean;
	details?: string;
}

// Test data - uses unique IDs to avoid conflicts
const TEST_SPOTIFY_ID = `smoke_test_${Date.now()}`;
const TEST_SONG: UpsertSongData = {
	spotify_id: TEST_SPOTIFY_ID,
	name: "Smoke Test Song",
	album_id: "test_album_001",
	album_name: "Test Album",
	image_url: "https://example.com/album.jpg",
	artists: ["Test Artist"],
	duration_ms: 180000,
	genres: ["test", "smoke"],
	popularity: 50,
	preview_url: null,
};

async function runTests(accountId: string): Promise<TestResult[]> {
	const results: TestResult[] = [];
	let testSongId: string | null = null;

	// ─────────────────────────────────────────────────────────────────────────
	// Test 1: Upsert Song
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Testing upsertSongs()...");

	const upsertResult = await upsertSongs([TEST_SONG]);
	if (Result.isOk(upsertResult) && upsertResult.value.length > 0) {
		testSongId = upsertResult.value[0].id;
		success(`Upserted song with ID: ${testSongId}`);
		dim(`spotify_id: ${upsertResult.value[0].spotify_id}`);
		results.push({ name: "upsertSongs", passed: true, details: "1 song upserted" });
	} else {
		const error = Result.isError(upsertResult) ? upsertResult.error.message : "No songs returned";
		fail(`upsertSongs failed: ${error}`);
		results.push({ name: "upsertSongs", passed: false, details: error });
		return results; // Can't continue without a song
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test 2: Get Song by ID
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Testing getSongById()...");

	const getByIdResult = await getSongById(testSongId);
	if (Result.isOk(getByIdResult) && getByIdResult.value) {
		success(`Found song: "${getByIdResult.value.name}"`);
		results.push({ name: "getSongById", passed: true });
	} else {
		const error = Result.isError(getByIdResult) ? getByIdResult.error.message : "Song not found";
		fail(`getSongById failed: ${error}`);
		results.push({ name: "getSongById", passed: false, details: error });
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test 3: Get Song by Spotify ID
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Testing getSongBySpotifyId()...");

	const getBySpotifyIdResult = await getSongBySpotifyId(TEST_SPOTIFY_ID);
	if (Result.isOk(getBySpotifyIdResult) && getBySpotifyIdResult.value) {
		success(`Found song by Spotify ID: "${getBySpotifyIdResult.value.name}"`);
		results.push({ name: "getSongBySpotifyId", passed: true });
	} else {
		const error = Result.isError(getBySpotifyIdResult) ? getBySpotifyIdResult.error.message : "Song not found";
		fail(`getSongBySpotifyId failed: ${error}`);
		results.push({ name: "getSongBySpotifyId", passed: false, details: error });
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test 4: Get Songs by Spotify IDs (batch)
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Testing getSongsBySpotifyIds()...");

	const getBatchResult = await getSongsBySpotifyIds([TEST_SPOTIFY_ID, "nonexistent_id"]);
	if (Result.isOk(getBatchResult)) {
		success(`Found ${getBatchResult.value.length} song(s) out of 2 requested`);
		results.push({ name: "getSongsBySpotifyIds", passed: true, details: `${getBatchResult.value.length} found` });
	} else {
		fail(`getSongsBySpotifyIds failed: ${getBatchResult.error.message}`);
		results.push({ name: "getSongsBySpotifyIds", passed: false, details: getBatchResult.error.message });
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test 5: Upsert Liked Song
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Testing upsertLikedSongs()...");

	const upsertLikedResult = await upsertLikedSongs(accountId, [
		{ song_id: testSongId, liked_at: new Date().toISOString() },
	]);
	if (Result.isOk(upsertLikedResult) && upsertLikedResult.value.length > 0) {
		success(`Upserted liked song`);
		dim(`liked_song.id: ${upsertLikedResult.value[0].id}`);
		results.push({ name: "upsertLikedSongs", passed: true });
	} else {
		const error = Result.isError(upsertLikedResult) ? upsertLikedResult.error.message : "No liked songs returned";
		fail(`upsertLikedSongs failed: ${error}`);
		results.push({ name: "upsertLikedSongs", passed: false, details: error });
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test 6: Get Liked Songs
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Testing getLikedSongs()...");

	const getLikedResult = await getLikedSongs(accountId);
	if (Result.isOk(getLikedResult)) {
		const found = getLikedResult.value.some((ls) => ls.song_id === testSongId);
		if (found) {
			success(`Found ${getLikedResult.value.length} liked song(s), including test song`);
			results.push({ name: "getLikedSongs", passed: true, details: `${getLikedResult.value.length} songs` });
		} else {
			fail("getLikedSongs returned songs but test song not found");
			results.push({ name: "getLikedSongs", passed: false, details: "Test song not in results" });
		}
	} else {
		fail(`getLikedSongs failed: ${getLikedResult.error.message}`);
		results.push({ name: "getLikedSongs", passed: false, details: getLikedResult.error.message });
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test 7: Get Pending Liked Songs (should include our test song)
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Testing getPendingLikedSongs()...");

	const pendingResult = await getPendingLikedSongs(accountId);
	if (Result.isOk(pendingResult)) {
		const found = pendingResult.value.some((ls) => ls.song_id === testSongId);
		if (found) {
			success(`Found ${pendingResult.value.length} pending song(s), including test song`);
			results.push({ name: "getPendingLikedSongs", passed: true, details: `${pendingResult.value.length} pending` });
		} else {
			fail("Test song should be pending (no status yet)");
			results.push({ name: "getPendingLikedSongs", passed: false, details: "Test song not pending" });
		}
	} else {
		fail(`getPendingLikedSongs failed: ${pendingResult.error.message}`);
		results.push({ name: "getPendingLikedSongs", passed: false, details: pendingResult.error.message });
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test 8: Update Liked Song Status
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Testing updateLikedSongStatus()...");

	const updateStatusResult = await updateLikedSongStatus(accountId, testSongId, "dismissed");
	if (Result.isOk(updateStatusResult)) {
		success(`Updated status to "dismissed"`);
		dim(`item_status.id: ${updateStatusResult.value.id}`);
		results.push({ name: "updateLikedSongStatus", passed: true });
	} else {
		fail(`updateLikedSongStatus failed: ${updateStatusResult.error.message}`);
		results.push({ name: "updateLikedSongStatus", passed: false, details: updateStatusResult.error.message });
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Test 9: Verify song is no longer pending
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Verifying song is no longer pending...");

	const pendingAfterResult = await getPendingLikedSongs(accountId);
	if (Result.isOk(pendingAfterResult)) {
		const stillPending = pendingAfterResult.value.some((ls) => ls.song_id === testSongId);
		if (!stillPending) {
			success("Test song correctly removed from pending list");
			results.push({ name: "pendingAfterStatus", passed: true });
		} else {
			fail("Test song still appears as pending after status update");
			results.push({ name: "pendingAfterStatus", passed: false, details: "Still pending" });
		}
	} else {
		fail(`Verification failed: ${pendingAfterResult.error.message}`);
		results.push({ name: "pendingAfterStatus", passed: false, details: pendingAfterResult.error.message });
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Cleanup: Remove test data
	// ─────────────────────────────────────────────────────────────────────────
	console.log("");
	info("Cleaning up test data...");

	// Delete item_status record
	const supabase = createAdminSupabaseClient();
	await supabase
		.from("item_status")
		.delete()
		.eq("account_id", accountId)
		.eq("item_id", testSongId)
		.eq("item_type", "song");

	// Test softDeleteLikedSong
	const deleteResult = await softDeleteLikedSong(accountId, testSongId);
	if (Result.isOk(deleteResult)) {
		success("Deleted liked song (softDeleteLikedSong works)");
		results.push({ name: "softDeleteLikedSong", passed: true });
	} else {
		fail(`softDeleteLikedSong failed: ${deleteResult.error.message}`);
		results.push({ name: "softDeleteLikedSong", passed: false, details: deleteResult.error.message });
	}

	// Delete test song
	await supabase.from("song").delete().eq("id", testSongId);
	dim("Removed test song from database");

	return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║         🎵 Songs Data Module Smoke Test                   ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);

	const args = process.argv.slice(2);
	const accountId = await resolveAccountId(args);

	dim(`Account ID: ${accountId}`);

	const results = await runTests(accountId);

	// Summary
	console.log(`
${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}
`);

	const passed = results.filter((r) => r.passed).length;
	const total = results.length;

	if (passed === total) {
		console.log(`${colors.green}🎯 All ${total} tests passed!${colors.reset}`);
		console.log(`${colors.dim}   The songs data module is working correctly.${colors.reset}`);
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
	console.error("Full error:", err);
	fail(`Unexpected error: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
	process.exit(1);
});

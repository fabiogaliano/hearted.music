#!/usr/bin/env bun
/**
 * Smoke Test: Spotify Service
 *
 * Verifies the refactored SpotifyService works against the real Spotify API.
 * Run after refactoring to gain confidence before shipping.
 *
 * Usage:
 *   bun scripts/smoke-tests/spotify-service.ts <account-id>
 *   bun scripts/smoke-tests/spotify-service.ts --spotify-id <spotify-user-id>
 *   bun scripts/smoke-tests/spotify-service.ts --list-accounts
 *
 * Prerequisites:
 *   - Valid .env with Supabase and Spotify credentials
 *   - At least one account with valid tokens in the database
 */

import { Result, matchError } from "better-result";
import { getSpotifyService } from "@/lib/services/spotify";
import { mapTrackToSongInsert, mapPlaylistToPlaylistInsert } from "@/lib/services/spotify/mappers";
import { getAccountById, getAccountBySpotifyId } from "@/lib/data/accounts";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { SpotifyError } from "@/lib/errors/spotify";

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

function formatError(error: SpotifyError): string {
	return matchError(error, {
		SpotifyRateLimitError: (e) => `Rate limited (retry after ${e.retryAfterMs}ms)`,
		SpotifyAuthError: (e) => `Auth failed: ${e.reason}`,
		SpotifyNotFoundError: (e) => `Not found: ${e.resourceType} ${e.resourceId}`,
		SpotifyApiError: (e) => `API error ${e.status}: ${e.message}`,
	});
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
	console.log("\n  Run with: bun scripts/smoke-tests/spotify-service.ts <account-id>\n");
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
  bun scripts/smoke-tests/spotify-service.ts <account-id>
  bun scripts/smoke-tests/spotify-service.ts --spotify-id <spotify-user-id>
  bun scripts/smoke-tests/spotify-service.ts --list-accounts
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

async function runTests(accountId: string): Promise<TestResult[]> {
	const results: TestResult[] = [];

	info("Initializing SpotifyService...");

	const spotifyResult = await getSpotifyService(accountId);
	if (Result.isError(spotifyResult)) {
		fail(`Failed to initialize: ${spotifyResult.error.message}`);
		dim("Token may be expired or revoked. Try logging in again.");
		process.exit(1);
	}
	const spotify = spotifyResult.value;
	success("SpotifyService initialized");

	// Test 1: Get Liked Tracks
	console.log("");
	info("Testing getLikedTracks()...");
	const tracksResult = await spotify.getLikedTracks();

	if (Result.isOk(tracksResult)) {
		const tracks = tracksResult.value;
		success(`Got ${tracks.length} liked tracks`);

		if (tracks.length > 0) {
			const sample = tracks[0];
			dim(`Sample: "${sample.track.name}" by ${sample.track.artists[0]?.name}`);

			// Verify mapper works
			const mapped = mapTrackToSongInsert(sample);
			dim(`Mapper output: { spotify_id: "${mapped.spotify_id}", name: "${mapped.name}" }`);
		}

		results.push({ name: "getLikedTracks", passed: true, details: `${tracks.length} tracks` });
	} else {
		fail(`getLikedTracks failed: ${formatError(tracksResult.error)}`);
		results.push({ name: "getLikedTracks", passed: false, details: formatError(tracksResult.error) });
	}

	// Test 2: Get Playlists
	console.log("");
	info("Testing getPlaylists()...");
	const playlistsResult = await spotify.getPlaylists();

	if (Result.isOk(playlistsResult)) {
		const playlists = playlistsResult.value;
		success(`Got ${playlists.length} playlists`);

		if (playlists.length > 0) {
			const sample = playlists[0];
			dim(`Sample: "${sample.name}" (${sample.track_count} tracks)`);

			// Verify mapper works
			const mapped = mapPlaylistToPlaylistInsert(sample, accountId);
			dim(`Mapper output: { spotify_id: "${mapped.spotify_id}", name: "${mapped.name}" }`);
		}

		results.push({ name: "getPlaylists", passed: true, details: `${playlists.length} playlists` });
	} else {
		fail(`getPlaylists failed: ${formatError(playlistsResult.error)}`);
		results.push({ name: "getPlaylists", passed: false, details: formatError(playlistsResult.error) });
	}

	// Test 3: Get Playlist Tracks (if playlists exist)
	if (Result.isOk(playlistsResult) && playlistsResult.value.length > 0) {
		const testPlaylist = playlistsResult.value[0];

		console.log("");
		info(`Testing getPlaylistTracks("${testPlaylist.id}")...`);
		const playlistTracksResult = await spotify.getPlaylistTracks(testPlaylist.id);

		if (Result.isOk(playlistTracksResult)) {
			success(`Got ${playlistTracksResult.value.length} tracks from "${testPlaylist.name}"`);
			results.push({ name: "getPlaylistTracks", passed: true, details: `${playlistTracksResult.value.length} tracks` });
		} else {
			fail(`getPlaylistTracks failed: ${formatError(playlistTracksResult.error)}`);
			results.push({ name: "getPlaylistTracks", passed: false, details: formatError(playlistTracksResult.error) });
		}
	}

	// Test 4: Get Album Art (if tracks exist)
	if (Result.isOk(tracksResult) && tracksResult.value.length > 0) {
		const trackIds = tracksResult.value.slice(0, 3).map((t) => t.track.id);

		console.log("");
		info(`Testing getTracksAlbumArt() with ${trackIds.length} tracks...`);
		const albumArtResult = await spotify.getTracksAlbumArt(trackIds);

		if (Result.isOk(albumArtResult)) {
			success(`Got album art for ${albumArtResult.value.size} tracks`);
			results.push({ name: "getTracksAlbumArt", passed: true, details: `${albumArtResult.value.size} URLs` });
		} else {
			fail(`getTracksAlbumArt failed: ${formatError(albumArtResult.error)}`);
			results.push({ name: "getTracksAlbumArt", passed: false, details: formatError(albumArtResult.error) });
		}
	}

	// Test 5: Get Artist Images (if tracks exist)
	if (Result.isOk(tracksResult) && tracksResult.value.length > 0) {
		const artistIds = [...new Set(
			tracksResult.value.slice(0, 5).flatMap((t) => t.track.artists.map((a) => a.id))
		)].slice(0, 3);

		console.log("");
		info(`Testing getArtistsImages() with ${artistIds.length} artists...`);
		const artistImagesResult = await spotify.getArtistsImages(artistIds);

		if (Result.isOk(artistImagesResult)) {
			success(`Got images for ${artistImagesResult.value.size} artists`);
			results.push({ name: "getArtistsImages", passed: true, details: `${artistImagesResult.value.size} URLs` });
		} else {
			fail(`getArtistsImages failed: ${formatError(artistImagesResult.error)}`);
			results.push({ name: "getArtistsImages", passed: false, details: formatError(artistImagesResult.error) });
		}
	}

	return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║         🔫 Spotify Service Smoke Test                     ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);

	const args = process.argv.slice(2);
	const accountId = await resolveAccountId(args);

	dim(`Account ID: ${accountId}`);
	console.log("");

	const results = await runTests(accountId);

	// Summary
	console.log(`
${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}
`);

	const passed = results.filter((r) => r.passed).length;
	const total = results.length;

	if (passed === total) {
		console.log(`${colors.green}🎯 All ${total} tests passed!${colors.reset}`);
		console.log(`${colors.dim}   The refactored SpotifyService is working correctly.${colors.reset}`);
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

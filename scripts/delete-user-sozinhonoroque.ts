#!/usr/bin/env bun
/**
 * Delete User Script
 *
 * Permanently deletes a user and ALL associated data from the database.
 * Hardcoded for sozinhonoroque@gmail.com.
 *
 * Usage:
 *   bun scripts/delete-user.ts
 *
 * What gets deleted (in FK-safe order):
 *   - match_result, match_context (matching data)
 *   - job_failure, job (background jobs)
 *   - item_status (UI state)
 *   - playlist_profile, playlist_analysis, playlist_song, playlist (playlists)
 *   - liked_song (liked songs)
 *   - api_token (extension tokens)
 *   - user_preferences (settings)
 *   - account (app-level user)
 *   - session, oauth_account (Better Auth)
 *   - user (Better Auth user)
 *
 * What is NOT deleted:
 *   - song, song_audio_feature, song_analysis, song_embedding (shared across users)
 *   - verification (not user-specific)
 */

import { createAdminSupabaseClient } from "@/lib/data/client";

const TARGET_EMAIL = "sozinhonoroque@gmail.com";

const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
};

function success(message: string) {
	console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function error(message: string) {
	console.log(`${colors.red}✗${colors.reset} ${message}`);
}

function info(message: string) {
	console.log(`${colors.cyan}ℹ${colors.reset} ${message}`);
}

function warn(message: string) {
	console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
}

function deleted(table: string, count: number) {
	if (count > 0) {
		console.log(`     ${colors.dim}-${colors.reset} ${count} ${table}`);
	}
}

async function main() {
	const supabase = createAdminSupabaseClient();

	info(`Looking up account for ${colors.bold}${TARGET_EMAIL}${colors.reset}`);

	const { data: account } = await supabase
		.from("account")
		.select("id, email, spotify_id, display_name, better_auth_user_id")
		.eq("email", TARGET_EMAIL)
		.single();

	if (!account) {
		error("Account not found");
		process.exit(1);
	}

	const accountId = account.id;
	const authUserId = account.better_auth_user_id;

	info("Found account:");
	console.log(`   ${colors.dim}ID:${colors.reset}        ${accountId}`);
	console.log(`   ${colors.dim}Email:${colors.reset}     ${account.email}`);
	console.log(`   ${colors.dim}Spotify:${colors.reset}   ${account.spotify_id ?? "(none)"}`);
	console.log(`   ${colors.dim}Name:${colors.reset}      ${account.display_name ?? "(none)"}`);
	console.log(`   ${colors.dim}Auth ID:${colors.reset}   ${authUserId ?? "(none)"}`);
	console.log();

	warn(`${colors.bold}This will PERMANENTLY DELETE this user and all their data.${colors.reset}`);
	console.log();

	// --- Phase 1: Delete account-linked data (same as reset, but we delete instead of reset) ---

	info("Phase 1: Deleting account data...");

	const { data: contexts } = await supabase
		.from("match_context")
		.select("id")
		.eq("account_id", accountId);
	const contextIds = contexts?.map((c) => c.id) ?? [];

	let matchResults = 0;
	if (contextIds.length > 0) {
		const { count } = await supabase
			.from("match_result")
			.delete({ count: "exact" })
			.in("context_id", contextIds);
		matchResults = count ?? 0;
	}

	const { count: matchContexts } = await supabase
		.from("match_context")
		.delete({ count: "exact" })
		.eq("account_id", accountId);

	const { data: jobs } = await supabase
		.from("job")
		.select("id")
		.eq("account_id", accountId);
	const jobIds = jobs?.map((j) => j.id) ?? [];

	let jobFailures = 0;
	if (jobIds.length > 0) {
		const { count } = await supabase
			.from("job_failure")
			.delete({ count: "exact" })
			.in("job_id", jobIds);
		jobFailures = count ?? 0;
	}

	const { count: jobCount } = await supabase
		.from("job")
		.delete({ count: "exact" })
		.eq("account_id", accountId);

	const { count: itemStatuses } = await supabase
		.from("item_status")
		.delete({ count: "exact" })
		.eq("account_id", accountId);

	const { data: playlists } = await supabase
		.from("playlist")
		.select("id")
		.eq("account_id", accountId);
	const playlistIds = playlists?.map((p) => p.id) ?? [];

	let playlistProfiles = 0;
	let playlistAnalyses = 0;
	let playlistSongs = 0;
	if (playlistIds.length > 0) {
		const r1 = await supabase
			.from("playlist_profile")
			.delete({ count: "exact" })
			.in("playlist_id", playlistIds);
		playlistProfiles = r1.count ?? 0;

		const r2 = await supabase
			.from("playlist_analysis")
			.delete({ count: "exact" })
			.in("playlist_id", playlistIds);
		playlistAnalyses = r2.count ?? 0;

		const r3 = await supabase
			.from("playlist_song")
			.delete({ count: "exact" })
			.in("playlist_id", playlistIds);
		playlistSongs = r3.count ?? 0;
	}

	const { count: playlistCount } = await supabase
		.from("playlist")
		.delete({ count: "exact" })
		.eq("account_id", accountId);

	const { count: likedSongs } = await supabase
		.from("liked_song")
		.delete({ count: "exact" })
		.eq("account_id", accountId);

	const { count: apiTokens } = await supabase
		.from("api_token")
		.delete({ count: "exact" })
		.eq("account_id", accountId);

	const { count: userPrefs } = await supabase
		.from("user_preferences")
		.delete({ count: "exact" })
		.eq("account_id", accountId);

	console.log(`   ${colors.dim}Deleted:${colors.reset}`);
	deleted("match results", matchResults);
	deleted("match contexts", matchContexts ?? 0);
	deleted("job failures", jobFailures);
	deleted("jobs", jobCount ?? 0);
	deleted("item statuses", itemStatuses ?? 0);
	deleted("playlist profiles", playlistProfiles);
	deleted("playlist analyses", playlistAnalyses);
	deleted("playlist songs", playlistSongs);
	deleted("playlists", playlistCount ?? 0);
	deleted("liked songs", likedSongs ?? 0);
	deleted("API tokens", apiTokens ?? 0);
	deleted("user preferences", userPrefs ?? 0);
	console.log();

	// --- Phase 2: Delete the account row itself ---

	info("Phase 2: Deleting account...");

	const { count: accountCount } = await supabase
		.from("account")
		.delete({ count: "exact" })
		.eq("id", accountId);
	deleted("account", accountCount ?? 0);
	console.log();

	// --- Phase 3: Delete Better Auth rows ---

	if (authUserId) {
		info("Phase 3: Deleting Better Auth data...");

		const { count: sessions } = await supabase
			.from("session")
			.delete({ count: "exact" })
			.eq("user_id", authUserId);

		const { count: oauthAccounts } = await supabase
			.from("oauth_account")
			.delete({ count: "exact" })
			.eq("user_id", authUserId);

		const { count: userCount } = await supabase
			.from("user")
			.delete({ count: "exact" })
			.eq("id", authUserId);

		deleted("sessions", sessions ?? 0);
		deleted("oauth accounts", oauthAccounts ?? 0);
		deleted("auth user", userCount ?? 0);
		console.log();
	} else {
		warn("No Better Auth user ID linked — skipping auth cleanup");
		console.log();
	}

	success(`${colors.bold}User ${TARGET_EMAIL} permanently deleted.${colors.reset}`);
}

main().catch((err) => {
	error(`Failed: ${err.message}`);
	process.exit(1);
});

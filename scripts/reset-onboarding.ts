#!/usr/bin/env bun
/**
 * Reset Onboarding Script
 *
 * Clears all user data and resets onboarding to the initial state.
 * Useful for testing the onboarding flow from scratch.
 *
 * Usage:
 *   bun scripts/reset-onboarding.ts <email>
 *   bun scripts/reset-onboarding.ts --account-id <uuid>
 *   bun scripts/reset-onboarding.ts --spotify-id <spotify-user-id>
 *
 * Examples:
 *   bun scripts/reset-onboarding.ts user@example.com
 *   bun scripts/reset-onboarding.ts --account-id e5ae9653-e31e-4722-8106-a0cb2111202c
 *   bun scripts/reset-onboarding.ts --spotify-id abc123xyz
 *
 * What gets deleted:
 *   - match_result, match_context (matching data)
 *   - job_failure, job (background jobs)
 *   - item_status (UI state)
 *   - playlist_profile, playlist_analysis, playlist_song, playlist (playlists)
 *   - liked_song (liked songs)
 *
 * What gets preserved:
 *   - account (the user account itself)
 *   - auth_token (so user stays logged in)
 *   - song data (shared across users)
 *
 * What gets reset:
 *   - user_preferences.onboarding_step → 'welcome'
 *   - user_preferences.onboarding_completed_at → NULL
 *   - user_preferences.phase_job_ids → NULL
 */

import { createAdminSupabaseClient } from "@/lib/data/client";

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

function error(message: string) {
	log(`${colors.red}✗${colors.reset}`, message);
}

function info(message: string) {
	log(`${colors.cyan}ℹ${colors.reset}`, message);
}

function printUsage() {
	console.log(`
${colors.bold}Reset Onboarding${colors.reset}
Clears user data and restarts onboarding from the beginning.

${colors.cyan}Usage:${colors.reset}
  bun scripts/reset-onboarding.ts <email>
  bun scripts/reset-onboarding.ts --account-id <uuid>
  bun scripts/reset-onboarding.ts --spotify-id <spotify-user-id>

${colors.cyan}Examples:${colors.reset}
  bun scripts/reset-onboarding.ts user@example.com
  bun scripts/reset-onboarding.ts --account-id e5ae9653-e31e-4722-8106-a0cb2111202c
`);
}

interface Account {
	id: string;
	email: string | null;
	spotify_id: string;
	display_name: string | null;
}

async function findAccount(supabase: ReturnType<typeof createAdminSupabaseClient>): Promise<Account | null> {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		printUsage();
		process.exit(1);
	}

	if (args[0] === "--account-id" && args[1]) {
		const { data } = await supabase
			.from("account")
			.select("id, email, spotify_id, display_name")
			.eq("id", args[1])
			.single();
		return data;
	}

	if (args[0] === "--spotify-id" && args[1]) {
		const { data } = await supabase
			.from("account")
			.select("id, email, spotify_id, display_name")
			.eq("spotify_id", args[1])
			.single();
		return data;
	}

	const email = args[0];
	const { data } = await supabase
		.from("account")
		.select("id, email, spotify_id, display_name")
		.eq("email", email)
		.single();
	return data;
}

interface DeleteCounts {
	match_results: number;
	match_contexts: number;
	job_failures: number;
	jobs: number;
	item_status: number;
	playlist_profiles: number;
	playlist_analyses: number;
	playlist_songs: number;
	playlists: number;
	liked_songs: number;
}

async function resetOnboarding(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string
): Promise<DeleteCounts> {
	const counts: DeleteCounts = {
		match_results: 0,
		match_contexts: 0,
		job_failures: 0,
		jobs: 0,
		item_status: 0,
		playlist_profiles: 0,
		playlist_analyses: 0,
		playlist_songs: 0,
		playlists: 0,
		liked_songs: 0,
	};

	const { data: contexts } = await supabase
		.from("match_context")
		.select("id")
		.eq("account_id", accountId);
	const contextIds = contexts?.map((c) => c.id) ?? [];

	if (contextIds.length > 0) {
		const { count } = await supabase
			.from("match_result")
			.delete({ count: "exact" })
			.in("context_id", contextIds);
		counts.match_results = count ?? 0;
	}

	{
		const { count } = await supabase
			.from("match_context")
			.delete({ count: "exact" })
			.eq("account_id", accountId);
		counts.match_contexts = count ?? 0;
	}

	const { data: jobs } = await supabase
		.from("job")
		.select("id")
		.eq("account_id", accountId);
	const jobIds = jobs?.map((j) => j.id) ?? [];

	if (jobIds.length > 0) {
		const { count } = await supabase
			.from("job_failure")
			.delete({ count: "exact" })
			.in("job_id", jobIds);
		counts.job_failures = count ?? 0;
	}

	{
		const { count } = await supabase
			.from("job")
			.delete({ count: "exact" })
			.eq("account_id", accountId);
		counts.jobs = count ?? 0;
	}

	{
		const { count } = await supabase
			.from("item_status")
			.delete({ count: "exact" })
			.eq("account_id", accountId);
		counts.item_status = count ?? 0;
	}

	const { data: playlists } = await supabase
		.from("playlist")
		.select("id")
		.eq("account_id", accountId);
	const playlistIds = playlists?.map((p) => p.id) ?? [];

	if (playlistIds.length > 0) {
		const { count } = await supabase
			.from("playlist_profile")
			.delete({ count: "exact" })
			.in("playlist_id", playlistIds);
		counts.playlist_profiles = count ?? 0;
	}

	if (playlistIds.length > 0) {
		const { count } = await supabase
			.from("playlist_analysis")
			.delete({ count: "exact" })
			.in("playlist_id", playlistIds);
		counts.playlist_analyses = count ?? 0;
	}

	if (playlistIds.length > 0) {
		const { count } = await supabase
			.from("playlist_song")
			.delete({ count: "exact" })
			.in("playlist_id", playlistIds);
		counts.playlist_songs = count ?? 0;
	}

	{
		const { count } = await supabase
			.from("playlist")
			.delete({ count: "exact" })
			.eq("account_id", accountId);
		counts.playlists = count ?? 0;
	}

	{
		const { count } = await supabase
			.from("liked_song")
			.delete({ count: "exact" })
			.eq("account_id", accountId);
		counts.liked_songs = count ?? 0;
	}

	await supabase
		.from("user_preferences")
		.update({
			onboarding_step: "welcome",
			onboarding_completed_at: null,
			phase_job_ids: null,
			updated_at: new Date().toISOString(),
		})
		.eq("account_id", accountId);

	return counts;
}

async function main() {
	const supabase = createAdminSupabaseClient();

	const account = await findAccount(supabase);

	if (!account) {
		error("Account not found");
		process.exit(1);
	}

	info(`Found account:`);
	console.log(`   ${colors.dim}ID:${colors.reset}       ${account.id}`);
	console.log(`   ${colors.dim}Email:${colors.reset}    ${account.email ?? "(none)"}`);
	console.log(`   ${colors.dim}Spotify:${colors.reset}  ${account.spotify_id}`);
	console.log(`   ${colors.dim}Name:${colors.reset}     ${account.display_name ?? "(none)"}`);
	console.log();

	info("Resetting onboarding...");
	const counts = await resetOnboarding(supabase, account.id);

	console.log();
	success("Onboarding reset complete!");
	console.log();
	console.log(`   ${colors.dim}Deleted:${colors.reset}`);
	if (counts.match_results > 0) console.log(`     - ${counts.match_results} match results`);
	if (counts.match_contexts > 0) console.log(`     - ${counts.match_contexts} match contexts`);
	if (counts.job_failures > 0) console.log(`     - ${counts.job_failures} job failures`);
	if (counts.jobs > 0) console.log(`     - ${counts.jobs} jobs`);
	if (counts.item_status > 0) console.log(`     - ${counts.item_status} item statuses`);
	if (counts.playlist_profiles > 0) console.log(`     - ${counts.playlist_profiles} playlist profiles`);
	if (counts.playlist_analyses > 0) console.log(`     - ${counts.playlist_analyses} playlist analyses`);
	if (counts.playlist_songs > 0) console.log(`     - ${counts.playlist_songs} playlist songs`);
	if (counts.playlists > 0) console.log(`     - ${counts.playlists} playlists`);
	if (counts.liked_songs > 0) console.log(`     - ${counts.liked_songs} liked songs`);

	const totalDeleted = Object.values(counts).reduce((a, b) => a + b, 0);
	if (totalDeleted === 0) {
		console.log(`     ${colors.dim}(no data to delete)${colors.reset}`);
	}

	console.log();
	console.log(`   ${colors.dim}Reset:${colors.reset}`);
	console.log(`     - onboarding_step → 'welcome'`);
	console.log(`     - onboarding_completed_at → NULL`);
	console.log(`     - phase_job_ids → NULL`);
	console.log();
	info(`User can now restart onboarding from the beginning.`);
}

main().catch((err) => {
	error(`Failed: ${err.message}`);
	process.exit(1);
});

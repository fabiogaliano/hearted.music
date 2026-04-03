#!/usr/bin/env bun
/**
 * Reset onboarding for an existing account.
 *
 * Default behavior is a warm reset for replaying onboarding:
 * - resets user_preferences onboarding fields and theme
 * - clears account-scoped workflow outputs/state
 * - preserves synced library rows and API token
 *
 * Optional flags let you force a colder reset:
 * - --wipe-library     delete liked songs + playlists for the account
 * - --clear-api-token  delete extension API token for the account
 *
 * Usage:
 *   bun scripts/reset-onboarding.ts <email>
 *   bun scripts/reset-onboarding.ts --account-id <uuid>
 *   bun scripts/reset-onboarding.ts --spotify-id <spotify-user-id>
 *   bun scripts/reset-onboarding.ts <email> --wipe-library --clear-api-token
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

function printUsage(): void {
	console.log(`
${colors.bold}Reset Onboarding${colors.reset}

${colors.cyan}Usage:${colors.reset}
  bun scripts/reset-onboarding.ts <email>
  bun scripts/reset-onboarding.ts --account-id <uuid>
  bun scripts/reset-onboarding.ts --spotify-id <spotify-user-id>
  bun scripts/reset-onboarding.ts <email> --wipe-library --clear-api-token

${colors.cyan}Default reset:${colors.reset}
  - onboarding_step -> welcome
  - onboarding_completed_at -> NULL
  - phase_job_ids -> NULL
  - theme -> NULL
  - playlist.is_target -> false
  - clear account-scoped workflow outputs: jobs, item_status, match data, match decisions,
    library_processing_state
  - preserve liked songs, playlists, and API token

${colors.cyan}Optional flags:${colors.reset}
  --wipe-library      Delete liked songs and playlists for the account
  --clear-api-token   Delete the account's extension API token
  --help              Show this help
`);
}

function success(message: string): void {
	console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function error(message: string): void {
	console.log(`${colors.red}✗${colors.reset} ${message}`);
}

function info(message: string): void {
	console.log(`${colors.cyan}ℹ${colors.reset} ${message}`);
}

interface TargetAccount {
	id: string;
	email: string | null;
	spotify_id: string | null;
	display_name: string | null;
}

type AccountSelector =
	| { kind: "email"; value: string }
	| { kind: "account-id"; value: string }
	| { kind: "spotify-id"; value: string };

interface ResetOptions {
	selector: AccountSelector;
	wipeLibrary: boolean;
	clearApiToken: boolean;
}

interface ResetCounts {
	libraryProcessingStates: number;
	matchDecisions: number;
	matchResults: number;
	matchSnapshots: number;
	jobFailures: number;
	jobs: number;
	itemStatuses: number;
	targetPlaylistsReset: number;
	likedSongsDeleted: number;
	playlistSongsDeleted: number;
	playlistProfilesDeleted: number;
	playlistAnalysesDeleted: number;
	playlistsDeleted: number;
	apiTokensDeleted: number;
}

function parseArgs(argv: string[]): ResetOptions {
	const args = argv.slice(2);
	if (args.length === 0 || args.includes("--help")) {
		printUsage();
		process.exit(0);
	}

	const wipeLibrary = args.includes("--wipe-library");
	const clearApiToken = args.includes("--clear-api-token");
	const positional = args.filter(
		(arg) => arg !== "--wipe-library" && arg !== "--clear-api-token",
	);

	if (positional[0] === "--account-id") {
		const value = positional[1];
		if (!value) {
			throw new Error("Missing value for --account-id");
		}
		return {
			selector: { kind: "account-id", value },
			wipeLibrary,
			clearApiToken,
		};
	}

	if (positional[0] === "--spotify-id") {
		const value = positional[1];
		if (!value) {
			throw new Error("Missing value for --spotify-id");
		}
		return {
			selector: { kind: "spotify-id", value },
			wipeLibrary,
			clearApiToken,
		};
	}

	if (positional[0]?.startsWith("--")) {
		throw new Error(`Unknown option: ${positional[0]}`);
	}

	const email = positional[0];
	if (!email) {
		throw new Error("Missing account selector");
	}

	return {
		selector: { kind: "email", value: email },
		wipeLibrary,
		clearApiToken,
	};
}

async function findAccount(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	selector: AccountSelector,
): Promise<TargetAccount | null> {
	let query = supabase
		.from("account")
		.select("id, email, spotify_id, display_name");

	switch (selector.kind) {
		case "account-id":
			query = query.eq("id", selector.value);
			break;
		case "spotify-id":
			query = query.eq("spotify_id", selector.value);
			break;
		case "email":
			query = query.eq("email", selector.value);
			break;
	}

	const { data, error: queryError } = await query.maybeSingle();
	if (queryError) {
		throw new Error(`Failed to look up account: ${queryError.message}`);
	}

	return data;
}

function makeEmptyCounts(): ResetCounts {
	return {
		libraryProcessingStates: 0,
		matchDecisions: 0,
		matchResults: 0,
		matchSnapshots: 0,
		jobFailures: 0,
		jobs: 0,
		itemStatuses: 0,
		targetPlaylistsReset: 0,
		likedSongsDeleted: 0,
		playlistSongsDeleted: 0,
		playlistProfilesDeleted: 0,
		playlistAnalysesDeleted: 0,
		playlistsDeleted: 0,
		apiTokensDeleted: 0,
	};
}

async function deleteCount(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	table:
		| "library_processing_state"
		| "match_snapshot"
		| "match_decision"
		| "job"
		| "item_status"
		| "liked_song"
		| "playlist"
		| "api_token",
	accountId: string,
): Promise<number> {
	const { count, error: deleteError } = await supabase
		.from(table)
		.delete({ count: "exact" })
		.eq("account_id", accountId);

	if (deleteError) {
		throw new Error(`Failed to delete from ${table}: ${deleteError.message}`);
	}

	return count ?? 0;
}

async function resetTargetPlaylists(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string,
): Promise<number> {
	const { data: targetRows, error: selectError } = await supabase
		.from("playlist")
		.select("id")
		.eq("account_id", accountId)
		.eq("is_target", true);

	if (selectError) {
		throw new Error(`Failed to load target playlists: ${selectError.message}`);
	}

	if (!targetRows || targetRows.length === 0) {
		return 0;
	}

	const { error: updateError } = await supabase
		.from("playlist")
		.update({ is_target: false })
		.eq("account_id", accountId)
		.eq("is_target", true);

	if (updateError) {
		throw new Error(`Failed to reset target playlists: ${updateError.message}`);
	}

	return targetRows.length;
}

async function clearMatchData(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string,
): Promise<Pick<ResetCounts, "matchResults" | "matchSnapshots" | "matchDecisions">> {
	const { data: snapshots, error: snapshotsError } = await supabase
		.from("match_snapshot")
		.select("id")
		.eq("account_id", accountId);
	if (snapshotsError) {
		throw new Error(`Failed to load match snapshots: ${snapshotsError.message}`);
	}

	const snapshotIds = (snapshots ?? []).map((snapshot) => snapshot.id);
	let matchResults = 0;
	if (snapshotIds.length > 0) {
		const { count, error: matchResultsError } = await supabase
			.from("match_result")
			.delete({ count: "exact" })
			.in("snapshot_id", snapshotIds);
		if (matchResultsError) {
			throw new Error(
				`Failed to delete match results: ${matchResultsError.message}`,
			);
		}
		matchResults = count ?? 0;
	}

	const matchSnapshots = await deleteCount(supabase, "match_snapshot", accountId);
	const matchDecisions = await deleteCount(
		supabase,
		"match_decision",
		accountId,
	);

	return { matchResults, matchSnapshots, matchDecisions };
}

async function clearJobs(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string,
): Promise<Pick<ResetCounts, "jobFailures" | "jobs">> {
	const { data: jobs, error: jobsError } = await supabase
		.from("job")
		.select("id")
		.eq("account_id", accountId);
	if (jobsError) {
		throw new Error(`Failed to load jobs: ${jobsError.message}`);
	}

	const jobIds = (jobs ?? []).map((job) => job.id);
	let jobFailures = 0;
	if (jobIds.length > 0) {
		const { count, error: failuresError } = await supabase
			.from("job_failure")
			.delete({ count: "exact" })
			.in("job_id", jobIds);
		if (failuresError) {
			throw new Error(`Failed to delete job failures: ${failuresError.message}`);
		}
		jobFailures = count ?? 0;
	}

	const jobsDeleted = await deleteCount(supabase, "job", accountId);
	return { jobFailures, jobs: jobsDeleted };
}

async function wipeLibraryRows(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string,
): Promise<
	Pick<
		ResetCounts,
		| "likedSongsDeleted"
		| "playlistSongsDeleted"
		| "playlistProfilesDeleted"
		| "playlistAnalysesDeleted"
		| "playlistsDeleted"
	>
> {
	const { data: playlists, error: playlistsError } = await supabase
		.from("playlist")
		.select("id")
		.eq("account_id", accountId);
	if (playlistsError) {
		throw new Error(`Failed to load playlists: ${playlistsError.message}`);
	}

	const playlistIds = (playlists ?? []).map((playlist) => playlist.id);
	let playlistProfilesDeleted = 0;
	let playlistAnalysesDeleted = 0;
	let playlistSongsDeleted = 0;

	if (playlistIds.length > 0) {
		const { count: profileCount, error: profileError } = await supabase
			.from("playlist_profile")
			.delete({ count: "exact" })
			.in("playlist_id", playlistIds);
		if (profileError) {
			throw new Error(
				`Failed to delete playlist profiles: ${profileError.message}`,
			);
		}
		playlistProfilesDeleted = profileCount ?? 0;

		const { count: analysisCount, error: analysisError } = await supabase
			.from("playlist_analysis")
			.delete({ count: "exact" })
			.in("playlist_id", playlistIds);
		if (analysisError) {
			throw new Error(
				`Failed to delete playlist analyses: ${analysisError.message}`,
			);
		}
		playlistAnalysesDeleted = analysisCount ?? 0;

		const { count: songCount, error: playlistSongsError } = await supabase
			.from("playlist_song")
			.delete({ count: "exact" })
			.in("playlist_id", playlistIds);
		if (playlistSongsError) {
			throw new Error(
				`Failed to delete playlist songs: ${playlistSongsError.message}`,
			);
		}
		playlistSongsDeleted = songCount ?? 0;
	}

	const playlistsDeleted = await deleteCount(supabase, "playlist", accountId);
	const likedSongsDeleted = await deleteCount(supabase, "liked_song", accountId);

	return {
		likedSongsDeleted,
		playlistSongsDeleted,
		playlistProfilesDeleted,
		playlistAnalysesDeleted,
		playlistsDeleted,
	};
}

async function resetUserPreferences(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string,
): Promise<void> {
	const { error: upsertError } = await supabase.from("user_preferences").upsert(
		{
			account_id: accountId,
			theme: null,
			onboarding_step: "welcome",
			onboarding_completed_at: null,
			phase_job_ids: null,
		},
		{ onConflict: "account_id" },
	);

	if (upsertError) {
		throw new Error(`Failed to reset user preferences: ${upsertError.message}`);
	}
}

async function resetOnboarding(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string,
	options: Pick<ResetOptions, "wipeLibrary" | "clearApiToken">,
): Promise<ResetCounts> {
	const counts = makeEmptyCounts();

	counts.libraryProcessingStates = await deleteCount(
		supabase,
		"library_processing_state",
		accountId,
	);

	const matchCounts = await clearMatchData(supabase, accountId);
	counts.matchResults = matchCounts.matchResults;
	counts.matchSnapshots = matchCounts.matchSnapshots;
	counts.matchDecisions = matchCounts.matchDecisions;

	const jobCounts = await clearJobs(supabase, accountId);
	counts.jobFailures = jobCounts.jobFailures;
	counts.jobs = jobCounts.jobs;

	counts.itemStatuses = await deleteCount(supabase, "item_status", accountId);

	if (options.wipeLibrary) {
		const libraryCounts = await wipeLibraryRows(supabase, accountId);
		counts.likedSongsDeleted = libraryCounts.likedSongsDeleted;
		counts.playlistSongsDeleted = libraryCounts.playlistSongsDeleted;
		counts.playlistProfilesDeleted = libraryCounts.playlistProfilesDeleted;
		counts.playlistAnalysesDeleted = libraryCounts.playlistAnalysesDeleted;
		counts.playlistsDeleted = libraryCounts.playlistsDeleted;
	} else {
		counts.targetPlaylistsReset = await resetTargetPlaylists(supabase, accountId);
	}

	if (options.clearApiToken) {
		counts.apiTokensDeleted = await deleteCount(supabase, "api_token", accountId);
	}

	await resetUserPreferences(supabase, accountId);
	return counts;
}

function printCounts(counts: ResetCounts): void {
	const rows: Array<[string, number]> = [
		["library processing state", counts.libraryProcessingStates],
		["match decisions", counts.matchDecisions],
		["match results", counts.matchResults],
		["match snapshots", counts.matchSnapshots],
		["job failures", counts.jobFailures],
		["jobs", counts.jobs],
		["item statuses", counts.itemStatuses],
		["target playlists reset", counts.targetPlaylistsReset],
		["liked songs deleted", counts.likedSongsDeleted],
		["playlist songs deleted", counts.playlistSongsDeleted],
		["playlist profiles deleted", counts.playlistProfilesDeleted],
		["playlist analyses deleted", counts.playlistAnalysesDeleted],
		["playlists deleted", counts.playlistsDeleted],
		["api tokens deleted", counts.apiTokensDeleted],
	];

	for (const [label, count] of rows) {
		if (count > 0) {
			console.log(`     - ${count} ${label}`);
		}
	}

	const total = rows.reduce((sum, [, count]) => sum + count, 0);
	if (total === 0) {
		console.log(`     ${colors.dim}(no rows changed)${colors.reset}`);
	}
}

async function main(): Promise<void> {
	let options: ResetOptions;
	try {
		options = parseArgs(process.argv);
	} catch (parseError) {
		printUsage();
		throw parseError;
	}

	const supabase = createAdminSupabaseClient();
	const account = await findAccount(supabase, options.selector);
	if (!account) {
		throw new Error("Account not found");
	}

	info("Found account:");
	console.log(`   ${colors.dim}ID:${colors.reset}       ${account.id}`);
	console.log(`   ${colors.dim}Email:${colors.reset}    ${account.email ?? "(none)"}`);
	console.log(`   ${colors.dim}Spotify:${colors.reset}  ${account.spotify_id ?? "(none)"}`);
	console.log(`   ${colors.dim}Name:${colors.reset}     ${account.display_name ?? "(none)"}`);
	console.log();

	info("Reset plan:");
	console.log(`   ${colors.dim}Mode:${colors.reset}     ${options.wipeLibrary ? "cold onboarding reset" : "warm onboarding reset"}`);
	console.log(`   ${colors.dim}Token:${colors.reset}    ${options.clearApiToken ? "clear API token" : "preserve API token"}`);
	console.log();

	const counts = await resetOnboarding(supabase, account.id, options);

	console.log();
	success("Onboarding reset complete");
	console.log();
	console.log(`   ${colors.dim}Changed:${colors.reset}`);
	printCounts(counts);
	console.log();
	console.log(`   ${colors.dim}Reset:${colors.reset}`);
	console.log("     - theme -> NULL");
	console.log("     - onboarding_step -> 'welcome'");
	console.log("     - onboarding_completed_at -> NULL");
	console.log("     - phase_job_ids -> NULL");
	if (!options.wipeLibrary) {
		console.log("     - playlist.is_target -> false");
		console.log("     - liked songs / playlists preserved");
	}
	if (options.wipeLibrary) {
		console.log("     - liked songs / playlists deleted");
	}
	if (!options.clearApiToken) {
		console.log("     - API token preserved");
	}
	console.log();
	info("User can now restart onboarding from welcome.");
}

main().catch((err: unknown) => {
	const message = err instanceof Error ? err.message : String(err);
	error(`Failed: ${message}`);
	process.exit(1);
});

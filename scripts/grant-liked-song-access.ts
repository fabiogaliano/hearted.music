#!/usr/bin/env bun
/**
 * Manually grant the liked-song access benefit to an existing account.
 *
 * Resolves an account by email / account id / Spotify id, prints a summary, and
 * applies the grant via the shared domain helper (origin = operator_manual).
 *
 * - If the account has active liked songs, the grant applies immediately and
 *   unlocks the current top 500.
 * - If the account exists but has not synced yet, a pending row is created and
 *   the next successful sync applies it automatically.
 * - Rerunning on an applied account reports already_applied and changes nothing
 *   (the original audit metadata is preserved by the RPC).
 *
 * Usage:
 *   bun scripts/grant-liked-song-access.ts <email>
 *   bun scripts/grant-liked-song-access.ts --account-id <uuid>
 *   bun scripts/grant-liked-song-access.ts --spotify-id <spotify-user-id>
 *   bun scripts/grant-liked-song-access.ts <email> --reason "VIP" --requested-by "ops@hearted"
 *   bun scripts/grant-liked-song-access.ts <email> --dry-run
 */

import { createAdminSupabaseClient } from "@/lib/data/client";
import { grantLikedSongAccessForAccount } from "@/lib/domains/billing/liked-song-access-grant";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { Result } from "better-result";

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
${colors.bold}Grant Liked-Song Access${colors.reset}

${colors.cyan}Usage:${colors.reset}
  bun scripts/grant-liked-song-access.ts <email>
  bun scripts/grant-liked-song-access.ts --account-id <uuid>
  bun scripts/grant-liked-song-access.ts --spotify-id <spotify-user-id>
  bun scripts/grant-liked-song-access.ts <email> --reason "VIP" --requested-by "ops@hearted"
  bun scripts/grant-liked-song-access.ts <email> --dry-run

${colors.cyan}Flags:${colors.reset}
  --account-id <uuid>        Resolve account by id
  --spotify-id <id>          Resolve account by Spotify user id
  --reason "..."             Stored as the grant note (audit)
  --requested-by "..."       Stored as the grant requested_by (audit)
  --dry-run                  Resolve and report only; creates no grant row
  --help                     Show this help
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

interface ExistingGrantRow {
	applied_at: string | null;
}

type AccountSelector =
	| { kind: "email"; value: string }
	| { kind: "account-id"; value: string }
	| { kind: "spotify-id"; value: string };

interface GrantOptions {
	selector: AccountSelector;
	reason: string | null;
	requestedBy: string | null;
	dryRun: boolean;
}

function takeFlagValue(args: string[], flag: string): string | null {
	const index = args.indexOf(flag);
	if (index === -1) return null;
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`Missing value for ${flag}`);
	}
	return value;
}

export function parseArgs(argv: string[]): GrantOptions {
	const args = argv.slice(2);
	if (args.length === 0 || args.includes("--help")) {
		printUsage();
		process.exit(0);
	}

	const reason = takeFlagValue(args, "--reason");
	const requestedBy = takeFlagValue(args, "--requested-by");
	const dryRun = args.includes("--dry-run");

	const accountId = takeFlagValue(args, "--account-id");
	if (accountId) {
		return {
			selector: { kind: "account-id", value: accountId },
			reason,
			requestedBy,
			dryRun,
		};
	}

	const spotifyId = takeFlagValue(args, "--spotify-id");
	if (spotifyId) {
		return {
			selector: { kind: "spotify-id", value: spotifyId },
			reason,
			requestedBy,
			dryRun,
		};
	}

	// Remaining positional (not a flag and not a flag value).
	const flagsWithValues = new Set(["--reason", "--requested-by"]);
	const positional = args.filter((arg, i) => {
		if (arg.startsWith("--")) return false;
		const prev = args[i - 1];
		if (prev && flagsWithValues.has(prev)) return false;
		return true;
	});

	const email = positional[0];
	if (!email) {
		throw new Error("Missing account selector (email, --account-id, or --spotify-id)");
	}

	return {
		selector: { kind: "email", value: email },
		reason,
		requestedBy,
		dryRun,
	};
}

// ilike gives a case-insensitive match without lowercasing the column. Wildcards
// are escaped so an email's literal `_`/`%` can't act as a pattern. The input is
// trimmed; account emails come from Better Auth and are already clean server-side.
export function escapeLikePattern(value: string): string {
	return value.replace(/([\\%_])/g, "\\$1");
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
			query = query.ilike("email", escapeLikePattern(selector.value.trim()));
			break;
	}

	const { data, error: queryError } = await query.maybeSingle();
	if (queryError) {
		throw new Error(`Failed to look up account: ${queryError.message}`);
	}

	return data;
}

async function readExistingGrant(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string,
): Promise<ExistingGrantRow | null> {
	const { data, error: queryError } = await supabase
		.from("account_liked_song_access_grant")
		.select("applied_at")
		.eq("account_id", accountId)
		.maybeSingle();
	if (queryError) {
		throw new Error(`Failed to look up existing grant: ${queryError.message}`);
	}
	return data;
}

async function countActiveLikedSongs(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string,
): Promise<number> {
	const { count, error: countError } = await supabase
		.from("liked_song")
		.select("id", { count: "exact", head: true })
		.eq("account_id", accountId)
		.is("unliked_at", null);

	if (countError) {
		throw new Error(`Failed to count liked songs: ${countError.message}`);
	}

	return count ?? 0;
}

function printAccount(account: TargetAccount, likedSongCount: number): void {
	info("Found account:");
	console.log(`   ${colors.dim}ID:${colors.reset}        ${account.id}`);
	console.log(`   ${colors.dim}Email:${colors.reset}     ${account.email ?? "(none)"}`);
	console.log(`   ${colors.dim}Spotify:${colors.reset}   ${account.spotify_id ?? "(none)"}`);
	console.log(`   ${colors.dim}Name:${colors.reset}      ${account.display_name ?? "(none)"}`);
	console.log(`   ${colors.dim}Liked:${colors.reset}     ${likedSongCount} active liked songs`);
	console.log();
}

export function previewDryRunOutcome(
	existingGrant: ExistingGrantRow | null,
	likedSongCount: number,
):
	| { status: "already_applied" }
	| { status: "pending_no_liked_songs" }
	| { status: "would_create_pending" }
	| { status: "would_apply"; candidateCount: number; fromPending: boolean } {
	if (existingGrant?.applied_at) {
		return { status: "already_applied" };
	}

	if (likedSongCount === 0) {
		return existingGrant
			? { status: "pending_no_liked_songs" }
			: { status: "would_create_pending" };
	}

	return {
		status: "would_apply",
		candidateCount: Math.min(likedSongCount, 500),
		fromPending: existingGrant !== null,
	};
}

async function main(): Promise<void> {
	let options: GrantOptions;
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

	const [existingGrant, likedSongCount] = await Promise.all([
		readExistingGrant(supabase, account.id),
		countActiveLikedSongs(supabase, account.id),
	]);
	printAccount(account, likedSongCount);

	if (options.dryRun) {
		const preview = previewDryRunOutcome(existingGrant, likedSongCount);
		switch (preview.status) {
			case "already_applied":
				info(`${colors.yellow}Dry run:${colors.reset} would return already_applied`);
				break;
			case "pending_no_liked_songs":
				info(
					`${colors.yellow}Dry run:${colors.reset} would return pending_no_liked_songs (the pending row already exists)`,
				);
				break;
			case "would_create_pending":
				info(
					`${colors.yellow}Dry run:${colors.reset} would create a pending row (no active liked songs yet)`,
				);
				break;
			case "would_apply":
				info(
					`${colors.yellow}Dry run:${colors.reset} would ${preview.fromPending ? "apply the existing pending row" : "apply"} and unlock the top ${preview.candidateCount} liked songs`,
				);
				break;
		}
		info("No grant row was created.");
		return;
	}

	const result = await grantLikedSongAccessForAccount(supabase, {
		accountId: account.id,
		origin: "operator_manual",
		requestedBy: options.requestedBy,
		note: options.reason,
	});

	if (Result.isError(result)) {
		throw new Error(`Grant failed: ${result.error.message}`);
	}

	const grant = result.value;
	console.log();
	switch (grant.status) {
		case "applied":
			success(
				`applied — ${grant.candidateCount} candidate songs, ${grant.newlyUnlockedSongIds.length} newly unlocked`,
			);
			break;
		case "already_applied":
			info("already_applied — this account was granted before; nothing changed");
			break;
		case "pending_no_liked_songs":
			info(
				"pending_no_liked_songs — no active liked songs yet; the next successful sync will apply the grant",
			);
			break;
	}
}

// Guard so importing this module (e.g. from tests) doesn't run the CLI; only a
// direct `bun scripts/grant-liked-song-access.ts` invocation executes main().
if (import.meta.main) {
	main().catch((err: unknown) => {
		error(`Failed: ${errorMessage(err)}`);
		process.exit(1);
	});
}

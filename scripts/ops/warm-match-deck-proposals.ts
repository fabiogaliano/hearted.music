#!/usr/bin/env bun
/**
 * Warm the Match deck read model: build deck proposals for every account that
 * has a published match_snapshot.
 *
 * This is a LATENCY optimization, not a correctness step. The deck read path
 * self-heals on a proposal miss (start_or_resume_match_deck's approach-X
 * first-window build), so an un-warmed account still works — it just eats a
 * one-time in-request build on first entry. Warming removes that first-entry
 * miss for the whole existing base after a deploy of the deck model.
 *
 * Mechanism: for each account's LATEST snapshot, enqueue a `build_proposals`
 * deck job for BOTH orientations via `enqueueDeckJob` (key
 * `build:{account}:{orientation}:{snapshot}:{visibilityConfigHash}`, payload
 * `{snapshotId}`) — the SAME trigger every other publish/miss/filter-change site
 * uses (execute.ts R2, match-deck-miss-path, the playlists filter rewire). The
 * hash is resolved once per account-orientation via resolveVisibilityConfigHash
 * so a warm enqueue can't dedupe against an in-flight build of stale filters/
 * strictness (M1). The running worker drains the jobs and chains
 * `append_sessions`. Enqueue is idempotent (the RPC's ON CONFLICT DO NOTHING on
 * the active-idempotency index), so a re-run — or a race with the worker's own
 * publish-triggered enqueue — is a benign no-op.
 *
 * Account iteration streams `match_snapshot` rows ordered (account_id ASC,
 * created_at DESC) and treats the first row seen per account as its latest —
 * so it never derives an id set and feeds it back as an `.in()` URL filter
 * (project rule) and never touches a snapshotless account. Errors are isolated
 * per account: one failed enqueue is logged and the run continues.
 *
 * Usage:
 *   bun scripts/ops/warm-match-deck-proposals.ts
 *   bun scripts/ops/warm-match-deck-proposals.ts --dry-run
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { enqueueDeckJob } from "@/lib/domains/taste/match-review-queue/deck-jobs";
import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import { resolveVisibilityConfigHash } from "@/lib/domains/taste/match-review-queue/visibility-config-hash";
import { errorMessage } from "@/lib/shared/errors/error-message";

const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
};

// Both deck orientations are warmed — the read path enters on either.
const ORIENTATIONS: readonly MatchOrientation[] = ["song", "playlist"];

// Page size for the snapshot stream. Only (account_id, id, created_at) is
// selected, so a large page is cheap; keeps the round-trip count low.
const SNAPSHOT_PAGE_SIZE = 1000;

function printUsage(): void {
	console.log(`
${colors.bold}Warm Match Deck Proposals${colors.reset}

Builds deck proposals for every account with a published match_snapshot by
enqueuing a build_proposals deck job (both orientations) for each account's
latest snapshot. Latency optimization only — the deck read path self-heals.

${colors.cyan}Usage:${colors.reset}
  bun scripts/ops/warm-match-deck-proposals.ts
  bun scripts/ops/warm-match-deck-proposals.ts --dry-run

${colors.cyan}Flags:${colors.reset}
  --dry-run   Count accounts + enqueues that WOULD happen; writes nothing
  --help      Show this help
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

interface WarmOptions {
	dryRun: boolean;
}

export function parseArgs(argv: string[]): WarmOptions {
	const args = argv.slice(2);
	if (args.includes("--help")) {
		printUsage();
		process.exit(0);
	}

	const known = new Set(["--dry-run"]);
	const unknown = args.find((arg) => arg.startsWith("--") && !known.has(arg));
	if (unknown) {
		throw new Error(`Unknown option: ${unknown}`);
	}

	return { dryRun: args.includes("--dry-run") };
}

export interface AccountLatestSnapshot {
	accountId: string;
	snapshotId: string;
}

/**
 * Streams the latest snapshot per account. The query orders (account_id ASC,
 * created_at DESC, id DESC), so the FIRST row seen for an account is its latest;
 * later rows for the same account (older snapshots) are skipped. Offset-paged so
 * only snapshot-having accounts are visited and no DB-derived id set is fed back
 * as an `.in()` filter.
 */
async function* iterateLatestSnapshotPerAccount(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
): AsyncGenerator<AccountLatestSnapshot> {
	const seen = new Set<string>();
	let offset = 0;

	while (true) {
		const { data, error: queryError } = await supabase
			.from("match_snapshot")
			.select("account_id, id, created_at")
			.order("account_id", { ascending: true })
			.order("created_at", { ascending: false })
			.order("id", { ascending: false })
			.range(offset, offset + SNAPSHOT_PAGE_SIZE - 1);

		if (queryError) {
			throw new Error(`Failed to page match_snapshot: ${queryError.message}`);
		}
		const rows = data ?? [];
		if (rows.length === 0) break;

		for (const row of rows) {
			if (seen.has(row.account_id)) continue;
			seen.add(row.account_id);
			yield { accountId: row.account_id, snapshotId: row.id };
		}

		if (rows.length < SNAPSHOT_PAGE_SIZE) break;
		offset += SNAPSHOT_PAGE_SIZE;
	}
}

export interface WarmCounts {
	accounts: number;
	enqueued: number;
	deduped: number;
	failed: number;
}

// Exported for direct testing (vitest seeds placeholder env vars, so importing
// this module in tests is safe — see the M1 hash-fail-skip regression test).
export async function warmAccount(
	target: AccountLatestSnapshot,
	dryRun: boolean,
	counts: WarmCounts,
): Promise<void> {
	for (const orientation of ORIENTATIONS) {
		if (dryRun) {
			counts.enqueued += 1;
			continue;
		}

		// Computed once per account-orientation (not inside any preset loop — the
		// build job itself handles all 3 presets). Folded into the idempotency key
		// (M1) so a warm enqueue can't dedupe against an in-flight build of stale
		// filters/strictness.
		const hashResult = await resolveVisibilityConfigHash(
			target.accountId,
			orientation,
		);
		if (Result.isError(hashResult)) {
			counts.failed += 1;
			error(
				`hash resolution failed (account=${target.accountId} orientation=${orientation}): ${hashResult.error.message}`,
			);
			continue;
		}

		const result = await enqueueDeckJob({
			accountId: target.accountId,
			orientation,
			kind: "build_proposals",
			idempotencyKey: `build:${target.accountId}:${orientation}:${target.snapshotId}:${hashResult.value.hash}`,
			payload: { snapshotId: target.snapshotId },
		});

		if (Result.isError(result)) {
			counts.failed += 1;
			error(
				`enqueue failed (account=${target.accountId} orientation=${orientation}): ${result.error.message}`,
			);
			continue;
		}
		// A null row means a non-terminal job for this key already existed (DO
		// NOTHING) — a benign dedupe, not an enqueue.
		if (result.value === null) {
			counts.deduped += 1;
		} else {
			counts.enqueued += 1;
		}
	}
}

async function main(): Promise<void> {
	let options: WarmOptions;
	try {
		options = parseArgs(process.argv);
	} catch (parseError) {
		printUsage();
		throw parseError;
	}

	const supabase = createAdminSupabaseClient();

	info(
		options.dryRun
			? "Dry run — counting accounts + enqueues, writing nothing."
			: "Enqueuing build_proposals for every account with a snapshot.",
	);
	console.log();

	const counts: WarmCounts = {
		accounts: 0,
		enqueued: 0,
		deduped: 0,
		failed: 0,
	};

	for await (const target of iterateLatestSnapshotPerAccount(supabase)) {
		counts.accounts += 1;
		// Per-account isolation: warmAccount swallows enqueue errors into counts;
		// only an unexpected throw would land here, and it must not abort the run.
		try {
			await warmAccount(target, options.dryRun, counts);
		} catch (accountError) {
			counts.failed += ORIENTATIONS.length;
			error(
				`account ${target.accountId} failed: ${errorMessage(accountError)}`,
			);
		}
	}

	console.log();
	success(options.dryRun ? "Dry run complete" : "Warm complete");
	console.log(`   ${colors.dim}Accounts:${colors.reset} ${counts.accounts}`);
	console.log(
		`   ${colors.dim}${options.dryRun ? "Would enqueue:" : "Enqueued:"}${colors.reset} ${counts.enqueued}`,
	);
	if (!options.dryRun) {
		console.log(`   ${colors.dim}Deduped:${colors.reset}  ${counts.deduped}`);
	}
	if (counts.failed > 0) {
		console.log(
			`   ${colors.yellow}Failed:${colors.reset}   ${counts.failed}`,
		);
	}
	console.log();
	if (!options.dryRun) {
		info("The running worker drains build_proposals and chains append_sessions.");
	}
}

// Guard so importing this module (e.g. from tests) doesn't run the CLI; only a
// direct `bun scripts/ops/warm-match-deck-proposals.ts` invocation executes main().
if (import.meta.main) {
	main().catch((err: unknown) => {
		error(`Failed: ${errorMessage(err)}`);
		process.exit(1);
	});
}

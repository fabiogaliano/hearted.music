#!/usr/bin/env bun
/**
 * Backfill `vocalGender` in `playlist.match_filters` from existing intent text.
 *
 * Scans ALL playlists with a non-empty `match_intent` (not target-only) and runs
 * `detectVocalGender` on the intent text. For unambiguous female/male detections
 * where no `vocalGender` is already stored, it writes the detected value into
 * `match_filters` while preserving all other existing filters unchanged.
 *
 * Safety contract:
 * - Default is DRY-RUN. Writes only happen when --apply is passed explicitly.
 * - Idempotent: playlists already having `matchFilters.vocalGender` are skipped.
 * - Playlists with invalid stored `match_filters` are skipped (not repaired).
 * - Invalidation is emitted only for accounts whose TARGET playlists changed.
 *
 * Usage (dry-run — always safe, default):
 *   bun scripts/backfill-playlist-match-filter-vocals.ts
 *   bun scripts/backfill-playlist-match-filter-vocals.ts --dry-run
 *
 * Usage (apply — writes to the DB):
 *   bun scripts/backfill-playlist-match-filter-vocals.ts --apply
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json } from "@/lib/data/database.types";
import { detectVocalGender } from "@/lib/domains/taste/match-filters/vocals-detector";
import { normalizeMatchFilters } from "@/lib/domains/taste/match-filters/normalizers";
import {
	parseStoredMatchFilters,
	parseSaveMatchFilters,
} from "@/lib/domains/taste/match-filters/schemas";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { PlaylistManagementChanges } from "@/lib/workflows/library-processing/changes";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";

// PostgREST caps responses at max_rows (1000); page past it.
const PAGE_SIZE = 1000;
// Each write batch is a separate DB round-trip. 100 keeps each request small
// without creating excessive write chatter for large corpora.
const WRITE_BATCH_SIZE = 100;

const COLORS = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
};

function log(message: string): void {
	console.log(message);
}

function warn(message: string): void {
	console.warn(`${COLORS.yellow}⚠${COLORS.reset}  ${message}`);
}

function fail(message: string): never {
	console.error(`${COLORS.red}✗${COLORS.reset}  ${message}`);
	process.exit(1);
}

export interface BackfillOptions {
	/** When true (the default), no DB writes occur. */
	dryRun: boolean;
}

export function parseArgs(argv: string[]): BackfillOptions {
	const args = argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		log(`
${COLORS.bold}Backfill playlist match-filter vocals${COLORS.reset}

Reads all playlists with non-empty match_intent, runs the vocals detector,
and writes vocalGender into match_filters for unambiguous detections.

${COLORS.cyan}Usage:${COLORS.reset}
  bun scripts/backfill-playlist-match-filter-vocals.ts            # dry-run (safe default)
  bun scripts/backfill-playlist-match-filter-vocals.ts --dry-run  # dry-run (explicit)
  bun scripts/backfill-playlist-match-filter-vocals.ts --apply    # write to DB

${COLORS.cyan}Flags:${COLORS.reset}
  --dry-run   Report planned changes without writing anything (DEFAULT)
  --no-apply  Alias for --dry-run
  --apply     Actually write detected vocalGender values to the DB
  --help      Show this help
`);
		process.exit(0);
	}

	const hasApply = args.includes("--apply");
	const hasDryRun = args.includes("--dry-run") || args.includes("--no-apply");

	// Unknown flags are an error — prevents typos silently defaulting to dry-run
	// when the user intended a write.
	const knownFlags = new Set(["--apply", "--dry-run", "--no-apply", "--help", "-h"]);
	for (const arg of args) {
		if (arg.startsWith("-") && !knownFlags.has(arg)) {
			fail(`Unknown flag: ${arg}. Pass --help for usage.`);
		}
	}

	if (hasApply && hasDryRun) {
		fail("Cannot pass both --apply and --dry-run.");
	}

	return { dryRun: !hasApply };
}

export interface PlaylistRow {
	id: string;
	account_id: string;
	match_intent: string;
	match_filters: unknown;
	genre_pills: string[];
	is_target: boolean;
}

export async function loadPlaylistsWithIntent(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
): Promise<PlaylistRow[]> {
	const rows: PlaylistRow[] = [];

	for (let from = 0; ; from += PAGE_SIZE) {
		const { data, error } = await supabase
			.from("playlist")
			.select("id, account_id, match_intent, match_filters, genre_pills, is_target")
			.not("match_intent", "is", null)
			.neq("match_intent", "")
			.order("id")
			.range(from, from + PAGE_SIZE - 1);

		if (error || !data) {
			throw new Error(`Failed to load playlists: ${error?.message ?? "no data"}`);
		}

		for (const row of data) {
			// The query already filters to non-null/non-empty, but match_intent
			// is typed nullable by the generated types so we narrow here.
			if (row.match_intent === null || row.match_intent === "") continue;
			rows.push({
				id: row.id,
				account_id: row.account_id,
				match_intent: row.match_intent,
				match_filters: row.match_filters,
				genre_pills: (row.genre_pills as string[]) ?? [],
				is_target: row.is_target ?? false,
			});
		}

		if (data.length < PAGE_SIZE) break;
	}

	return rows;
}

// Pure functions — exported so tests can exercise decision logic without a real DB.
export type DecisionKind =
	| "write-female"
	| "write-male"
	| "skip-existing"
	| "skip-ambiguous"
	| "skip-none"
	| "skip-invalid";

export interface PlaylistDecision {
	playlistId: string;
	accountId: string;
	isTarget: boolean;
	kind: DecisionKind;
	/** Present only for write-* decisions. */
	newFilters?: PlaylistMatchFiltersV1;
}

/**
 * Decide what to do with a single playlist row.
 *
 * - Invalid stored filters → skip-invalid (the script must not silently repair
 *   corrupt rows; only an explicit save from the editor repairs them per §6).
 * - Already has vocalGender → skip-existing (idempotency: never clobber).
 * - Ambiguous detection → skip-ambiguous.
 * - No detection → skip-none.
 * - Unambiguous female/male → plan write, merging into existing valid filters.
 */
export function decidePlaylist(row: PlaylistRow): PlaylistDecision {
	const base = {
		playlistId: row.id,
		accountId: row.account_id,
		isTarget: row.is_target,
	};

	// Forgiving read parse — unknown keys are ignored; invalid known fields
	// cause wasNormalized=true which we treat as skip-invalid.
	const stored = parseStoredMatchFilters(row.match_filters);

	if (stored.wasNormalized) {
		// wasNormalized means an existing known field was invalid; the stored
		// object is corrupt. Skip rather than silently clobber.
		return { ...base, kind: "skip-invalid" };
	}

	if (stored.value.vocalGender !== undefined) {
		return { ...base, kind: "skip-existing" };
	}

	const detection = detectVocalGender(row.match_intent);

	if (detection.kind === "ambiguous") {
		return { ...base, kind: "skip-ambiguous" };
	}
	if (detection.kind === "none") {
		return { ...base, kind: "skip-none" };
	}

	// Build the new filters: spread existing valid fields, add vocalGender.
	const newFilters: PlaylistMatchFiltersV1 = {
		...stored.value,
		vocalGender: detection.kind,
	};

	// Validate through the strict save-time parser to catch any edge case where
	// the merged object has unexpected structure before writing.
	const saveCheck = parseSaveMatchFilters(newFilters);
	if (Result.isError(saveCheck)) {
		warn(
			`playlist ${row.id}: merged filters failed strict validation (${saveCheck.error}) — skipping`,
		);
		return { ...base, kind: "skip-invalid" };
	}

	return {
		...base,
		kind: detection.kind === "female" ? "write-female" : "write-male",
		// Validation accepts valid-but-noncanonical input (e.g. duplicate language
		// codes); canonicalize before writing so the backfill upholds the same
		// "storage never holds a denormalized object" invariant as the editor save
		// path (playlists.functions saveMatchConfig) and CMHF-18's normalized-write
		// requirement.
		newFilters: normalizeMatchFilters(saveCheck.value),
	};
}

export interface WriteTarget {
	playlistId: string;
	accountId: string;
	isTarget: boolean;
	newFilters: PlaylistMatchFiltersV1;
}

export async function writeBatch(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	batch: WriteTarget[],
	dryRun: boolean,
): Promise<{ succeeded: WriteTarget[]; failed: Array<{ target: WriteTarget; error: string }> }> {
	// Defense-in-depth: if this function is ever called in dry-run (e.g. after a
	// future refactor moves the call site), fail loudly rather than silently writing.
	if (dryRun) {
		throw new Error("writeBatch called in dry-run mode");
	}

	const succeeded: WriteTarget[] = [];
	const failed: Array<{ target: WriteTarget; error: string }> = [];

	// Sequential writes per playlist: each is account-scoped and idempotent, so
	// there is no benefit to parallelism at the cost of harder error attribution.
	for (const target of batch) {
		const { error } = await supabase
			.from("playlist")
			.update({ match_filters: target.newFilters as Json })
			.eq("id", target.playlistId)
			.eq("account_id", target.accountId);

		if (error) {
			failed.push({ target, error: error.message });
		} else {
			succeeded.push(target);
		}
	}

	return { succeeded, failed };
}

/**
 * Emit metadata-changed invalidation for each account that had at least one
 * TARGET playlist written. Non-target playlist writes don't affect the
 * matching snapshot so their accounts are not invalidated.
 */
async function invalidateChangedTargetAccounts(
	accountIds: Iterable<string>,
): Promise<void> {
	for (const accountId of accountIds) {
		const result = await applyLibraryProcessingChange(
			PlaylistManagementChanges.sessionFlushed({
				accountId,
				targetMembershipChanged: false,
				scoringConfigChanged: true,
				readTimeFilterChanged: false,
			}),
		);
		if (Result.isError(result)) {
			// Non-fatal: the write already happened. Log degraded success so
			// the operator knows to trigger an organic snapshot refresh later.
			warn(
				`Invalidation failed for account ${accountId}: ${errorMessage(result.error)} — ` +
					"match snapshot will recompute on next organic trigger",
			);
		}
	}
}

interface RunSummary {
	totalScanned: number;
	writeFemale: number;
	writeMale: number;
	skipExisting: number;
	skipAmbiguous: number;
	skipNone: number;
	skipInvalid: number;
	wrote: number;
	errors: number;
	dryRun: boolean;
}

function printSummary(summary: RunSummary): void {
	const mode = summary.dryRun
		? `${COLORS.yellow}DRY-RUN${COLORS.reset}`
		: `${COLORS.green}APPLY${COLORS.reset}`;

	const writeVerb = summary.dryRun ? "would-write" : "wrote";

	log(`\n${COLORS.bold}─── Vocals backfill summary [${mode}${COLORS.bold}] ───${COLORS.reset}`);
	log(`  Scanned:          ${summary.totalScanned}`);
	log(`  ${writeVerb} female: ${summary.writeFemale}`);
	log(`  ${writeVerb} male:   ${summary.writeMale}`);
	log(`  Skipped (existing vocalGender): ${summary.skipExisting}`);
	log(`  Skipped (ambiguous detection):  ${summary.skipAmbiguous}`);
	log(`  Skipped (no signal):            ${summary.skipNone}`);
	log(`  Skipped (invalid stored filters): ${summary.skipInvalid}`);

	if (!summary.dryRun) {
		log(`  Written:  ${summary.wrote}`);
		log(`  Errors:   ${summary.errors}`);
	}

	if (summary.errors > 0) {
		log(`\n${COLORS.red}✗${COLORS.reset}  ${summary.errors} write error(s). See above for details.`);
	} else if (summary.dryRun) {
		log(
			`\n${COLORS.cyan}ℹ${COLORS.reset}  Dry-run complete — no rows were written.\n` +
				`   Re-run with ${COLORS.bold}--apply${COLORS.reset} to write ${summary.writeFemale + summary.writeMale} row(s).`,
		);
	} else {
		log(`\n${COLORS.green}✓${COLORS.reset}  Done.`);
	}
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv);

	log(
		`${COLORS.bold}Vocals backfill${COLORS.reset} — mode: ${
			options.dryRun
				? `${COLORS.yellow}dry-run${COLORS.reset} (pass --apply to write)`
				: `${COLORS.green}APPLY${COLORS.reset}`
		}`,
	);
	log("");

	const supabase = createAdminSupabaseClient();

	log("Loading playlists with non-empty match_intent …");
	const rows = await loadPlaylistsWithIntent(supabase);
	log(`  ${rows.length} playlist(s) to evaluate\n`);

	// Classify every playlist row.
	const decisions = rows.map(decidePlaylist);

	const toWrite = decisions.filter(
		(d): d is PlaylistDecision & { kind: "write-female" | "write-male"; newFilters: PlaylistMatchFiltersV1 } =>
			d.kind === "write-female" || d.kind === "write-male",
	);

	const counts = {
		writeFemale: decisions.filter((d) => d.kind === "write-female").length,
		writeMale: decisions.filter((d) => d.kind === "write-male").length,
		skipExisting: decisions.filter((d) => d.kind === "skip-existing").length,
		skipAmbiguous: decisions.filter((d) => d.kind === "skip-ambiguous").length,
		skipNone: decisions.filter((d) => d.kind === "skip-none").length,
		skipInvalid: decisions.filter((d) => d.kind === "skip-invalid").length,
	};

	if (options.dryRun) {
		log(`Would write vocalGender to ${toWrite.length} playlist(s):`);
		log(`  female: ${counts.writeFemale},  male: ${counts.writeMale}`);

		// Sample up to 5 planned writes so the operator can spot-check intent.
		if (toWrite.length > 0) {
			log("\nSample (up to 5 planned writes):");
			for (const d of toWrite.slice(0, 5)) {
				const gender = d.kind === "write-female" ? "female" : "male";
				log(`  playlist ${d.playlistId}  →  vocalGender: ${gender}  (is_target=${d.isTarget})`);
			}
			if (toWrite.length > 5) {
				log(`  … and ${toWrite.length - 5} more`);
			}
		}

		printSummary({
			totalScanned: rows.length,
			...counts,
			wrote: 0,
			errors: 0,
			dryRun: true,
		});
		return;
	}

	// Apply mode: batch writes.
	let totalWrote = 0;
	let totalErrors = 0;
	const invalidatedAccountIds = new Set<string>();

	for (let i = 0; i < toWrite.length; i += WRITE_BATCH_SIZE) {
		const batch = toWrite.slice(i, i + WRITE_BATCH_SIZE);
		log(
			`Writing batch ${Math.floor(i / WRITE_BATCH_SIZE) + 1}/${Math.ceil(toWrite.length / WRITE_BATCH_SIZE)} ` +
				`(${batch.length} rows) …`,
		);

		const writeTargets: WriteTarget[] = batch.map((d) => ({
			playlistId: d.playlistId,
			accountId: d.accountId,
			isTarget: d.isTarget,
			newFilters: d.newFilters,
		}));

		const { succeeded, failed } = await writeBatch(supabase, writeTargets, false);

		totalWrote += succeeded.length;
		totalErrors += failed.length;

		for (const s of succeeded) {
			// Only target playlists affect the matching snapshot.
			if (s.isTarget) {
				invalidatedAccountIds.add(s.accountId);
			}
		}

		for (const f of failed) {
			console.error(
				`${COLORS.red}✗${COLORS.reset}  Failed to write playlist ${f.target.playlistId}: ${f.error}`,
			);
		}
	}

	if (invalidatedAccountIds.size > 0) {
		log(`\nInvalidating ${invalidatedAccountIds.size} account(s) with changed target playlists …`);
		await invalidateChangedTargetAccounts(invalidatedAccountIds);
	}

	printSummary({
		totalScanned: rows.length,
		...counts,
		wrote: totalWrote,
		errors: totalErrors,
		dryRun: false,
	});

	if (totalErrors > 0) {
		process.exit(1);
	}
}

if (import.meta.main) {
	main().catch((err: unknown) => {
		console.error(`${COLORS.red}✗${COLORS.reset}  Fatal: ${errorMessage(err)}`);
		process.exit(1);
	});
}

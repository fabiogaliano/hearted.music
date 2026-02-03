#!/usr/bin/env bun
/**
 * Backfill Popularity & ISRC
 *
 * Populates popularity and isrc fields for existing songs.
 * Uses Spotify's batch tracks API (50 tracks per request).
 *
 * Usage:
 *   bun scripts/backfill-popularity-isrc.ts
 *   bun scripts/backfill-popularity-isrc.ts --dry-run
 *   bun scripts/backfill-popularity-isrc.ts --limit 100
 */

import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { appFetch } from "@/lib/integrations/spotify/app-auth";
import { ConcurrencyLimiter } from "@/lib/shared/utils/concurrency";

const BATCH_SIZE = 50;
const PAGE_SIZE = 1000;
const CONCURRENCY = 3;
const MIN_INTERVAL_MS = 200;

const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
};

function success(msg: string) { console.log(`${colors.green}✓${colors.reset} ${msg}`); }
function error(msg: string) { console.log(`${colors.red}✗${colors.reset} ${msg}`); }
function info(msg: string) { console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`); }
function progress(msg: string) { console.log(`${colors.yellow}→${colors.reset} ${msg}`); }

const TracksSchema = z.object({
	tracks: z.array(
		z.object({
			id: z.string(),
			popularity: z.number(),
			external_ids: z.object({
				isrc: z.string().optional(),
			}).optional(),
		}).nullable()
	),
});

function chunkArray<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

interface Song {
	id: string;
	spotify_id: string;
}

async function main() {
	const args = process.argv.slice(2);
	const dryRun = args.includes("--dry-run");
	const limitIndex = args.indexOf("--limit");
	const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : undefined;

	console.log();
	console.log(`${colors.bold}Backfill Popularity & ISRC${colors.reset}`);
	console.log();

	if (dryRun) {
		info("Dry run mode - no changes will be made");
		console.log();
	}

	const supabase = createAdminSupabaseClient();

	info("Fetching songs missing popularity or isrc...");

	// Paginate through songs where popularity is null
	const allSongs: Song[] = [];
	let offset = 0;
	let hasMore = true;

	while (hasMore) {
		const pageLimit = limit ? Math.min(PAGE_SIZE, limit - allSongs.length) : PAGE_SIZE;

		const { data: pageSongs, error: fetchError } = await supabase
			.from("song")
			.select("id, spotify_id")
			.is("popularity", null)
			.range(offset, offset + pageLimit - 1)
			.order("created_at", { ascending: true });

		if (fetchError) {
			error(`Failed to fetch songs: ${fetchError.message}`);
			process.exit(1);
		}

		if (!pageSongs || pageSongs.length === 0) {
			hasMore = false;
		} else {
			allSongs.push(...(pageSongs as Song[]));
			offset += pageSongs.length;

			if (limit && allSongs.length >= limit) {
				hasMore = false;
			} else if (pageSongs.length < pageLimit) {
				hasMore = false;
			}
		}

		if (hasMore) {
			progress(`Fetched ${allSongs.length} songs so far...`);
		}
	}

	if (allSongs.length === 0) {
		success("All songs already have popularity populated!");
		return;
	}

	info(`Found ${allSongs.length} songs to backfill`);
	console.log();

	const limiter = new ConcurrencyLimiter(CONCURRENCY, MIN_INTERVAL_MS);
	const chunks = chunkArray(allSongs, BATCH_SIZE);
	let processed = 0;
	let updated = 0;
	let failed = 0;

	for (const chunk of chunks) {
		await limiter.run(async () => {
			const spotifyIds = chunk.map((s) => s.spotify_id).join(",");
			const result = await appFetch(`/tracks?ids=${spotifyIds}`, TracksSchema);

			if (Result.isError(result)) {
				error(`Batch failed: ${result.error.message}`);
				failed += chunk.length;
				return;
			}

			for (const track of result.value.tracks) {
				if (!track) continue;
				const song = chunk.find((s) => s.spotify_id === track.id);
				if (!song) continue;

				if (!dryRun) {
					const { error: updateError } = await supabase
						.from("song")
						.update({
							popularity: track.popularity,
							isrc: track.external_ids?.isrc ?? null,
						})
						.eq("id", song.id);

					if (updateError) {
						error(`Failed to update ${song.id}: ${updateError.message}`);
						failed++;
					} else {
						updated++;
					}
				} else {
					updated++;
				}
			}

			processed += chunk.length;
			progress(`Processed ${processed}/${allSongs.length} songs`);
		});
	}

	console.log();
	success("Backfill complete!");
	console.log();
	console.log(`   ${colors.dim}Summary:${colors.reset}`);
	console.log(`     - Songs processed: ${processed}`);
	console.log(`     - Songs updated: ${updated}`);
	if (failed > 0) {
		console.log(`     - ${colors.red}Failed: ${failed}${colors.reset}`);
	}
	if (dryRun) {
		console.log();
		info("Run without --dry-run to apply changes.");
	}
}

main().catch((err) => {
	error(`Failed: ${err.message}`);
	process.exit(1);
});

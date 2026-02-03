#!/usr/bin/env bun
/**
 * Backfill Artist IDs Script
 *
 * Populates the artist_ids column for existing songs that only have artist names.
 * Uses Spotify's batch tracks API (50 tracks per request) for efficiency.
 *
 * Usage:
 *   bun scripts/backfill-artist-ids.ts
 *   bun scripts/backfill-artist-ids.ts --dry-run
 *   bun scripts/backfill-artist-ids.ts --limit 100
 *
 * Options:
 *   --dry-run    Show what would be updated without making changes
 *   --limit N    Only process N songs (default: all)
 */

import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { appFetch } from "@/lib/integrations/spotify/app-auth";
import { ConcurrencyLimiter } from "@/lib/shared/utils/concurrency";

const BATCH_SIZE = 50; // Spotify API limit for /tracks endpoint
const PAGE_SIZE = 1000; // Supabase fetch page size
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

function progress(message: string) {
	log(`${colors.yellow}→${colors.reset}`, message);
}

const TracksSchema = z.object({
	tracks: z.array(
		z
			.object({
				id: z.string(),
				artists: z.array(z.object({ id: z.string() })),
			})
			.nullable()
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
	console.log(`${colors.bold}Backfill Artist IDs${colors.reset}`);
	console.log(`${colors.dim}Populating artist_ids for existing songs${colors.reset}`);
	console.log();

	if (dryRun) {
		info("Dry run mode - no changes will be made");
		console.log();
	}

	const supabase = createAdminSupabaseClient();

	info("Fetching songs without artist_ids...");

	// Paginate through all songs since Supabase limits to 1000 rows per query
	const allSongs: Song[] = [];
	let offset = 0;
	let hasMore = true;

	while (hasMore) {
		const pageLimit = limit ? Math.min(PAGE_SIZE, limit - allSongs.length) : PAGE_SIZE;

		const { data: pageSongs, error: fetchError } = await supabase
			.from("song")
			.select("id, spotify_id")
			.filter("artist_ids", "eq", "{}")
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

			// Stop if we hit user-specified limit or got fewer than requested (end of data)
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

	const songs = allSongs;

	if (songs.length === 0) {
		success("All songs already have artist_ids populated!");
		return;
	}

	info(`Found ${songs.length} songs to backfill`);
	console.log();

	const limiter = new ConcurrencyLimiter(CONCURRENCY, MIN_INTERVAL_MS);
	const chunks = chunkArray(songs as Song[], BATCH_SIZE);
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

			const updates: Array<{ songId: string; artistIds: string[] }> = [];

			for (const track of result.value.tracks) {
				if (!track) continue;
				const artistIds = track.artists.map((a) => a.id);
				const song = chunk.find((s) => s.spotify_id === track.id);
				if (!song) continue;

				updates.push({ songId: song.id, artistIds });
			}

			if (!dryRun) {
				for (const { songId, artistIds } of updates) {
					const { error: updateError } = await supabase
						.from("song")
						.update({ artist_ids: artistIds })
						.eq("id", songId);

					if (updateError) {
						error(`Failed to update song ${songId}: ${updateError.message}`);
						failed++;
					} else {
						updated++;
					}
				}
			} else {
				updated += updates.length;
			}

			processed += chunk.length;
			progress(`Processed ${processed}/${songs.length} songs`);
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
		info("This was a dry run. Run without --dry-run to apply changes.");
	}
}

main().catch((err) => {
	error(`Failed: ${err.message}`);
	process.exit(1);
});

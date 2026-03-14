#!/usr/bin/env bun

import { Result } from "better-result";
/**
 * Lyrics Snapshot Generator
 *
 * Captures current Genius API output as test snapshots for the LyricsService.
 * These snapshots are used to detect:
 * - Parser regressions (our code broke)
 * - Genius HTML changes (their structure changed)
 *
 * If a snapshot already exists, creates a timestamped version for comparison.
 * This lets you diff old vs new before deciding to replace the baseline.
 *
 * Run with: bun src/lib/services/lyrics/__tests__/generate-snapshots.ts
 */
import { existsSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { LyricsService } from "../service";
import type { TransformedLyricsBySection } from "../utils/lyrics-transformer";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEST_SONGS = [
	{ artist: "Daniel Caesar", song: "Best Part" },
	{ artist: "Sam Fender", song: "Rein Me In" },
	{ artist: "Kendrick Lamar", song: "All The Stars" },
	{ artist: "The Weeknd", song: "Blinding Lights" },
	{ artist: "Westside Gunn", song: "327" },
];

export interface Snapshot {
	metadata: {
		captureDate: string;
		artist: string;
		song: string;
	};
	result: TransformedLyricsBySection[];
}

const SNAPSHOTS_DIR = join(__dirname, "snapshots");

async function generateSnapshots() {
	const token = process.env.GENIUS_CLIENT_TOKEN;
	if (!token) {
		console.error("ERROR: GENIUS_CLIENT_TOKEN environment variable not set");
		console.error(
			"Run with: bun src/lib/services/lyrics/__tests__/generate-snapshots.ts",
		);
		process.exit(1);
	}

	const service = new LyricsService({ accessToken: token });
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const today = new Date().toISOString().split("T")[0];

	console.log("📸 Capturing lyrics snapshots from Genius API...\n");

	let newCount = 0;
	let updateCount = 0;

	for (const { artist, song } of TEST_SONGS) {
		try {
			console.log(`Fetching: ${artist} - ${song}`);
			const result = await service.getLyrics(artist, song);
			if (Result.isError(result)) {
				console.error(`  ✗ Failed: ${artist} - ${song}`, result.error);
				continue;
			}

			const snapshot: Snapshot = {
				metadata: {
					captureDate: today,
					artist,
					song,
				},
				result: result.value,
			};

			const slug = `${artist}-${song}`
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-");
			const baseFilename = `${slug}.json`;
			const basePath = join(SNAPSHOTS_DIR, baseFilename);

			let savedFilename: string;

			if (existsSync(basePath)) {
				// Existing baseline - create timestamped version for comparison
				savedFilename = `${slug}_${timestamp}.json`;
				updateCount++;
				console.log(`  ⚡ Baseline exists, creating: ${savedFilename}`);
			} else {
				// No baseline - create it
				savedFilename = baseFilename;
				newCount++;
				console.log(`  ✨ New baseline: ${savedFilename}`);
			}

			const filepath = join(SNAPSHOTS_DIR, savedFilename);
			writeFileSync(filepath, JSON.stringify(snapshot, null, "\t"));

			const totalLines = result.value.reduce(
				(acc, s) => acc + s.lines.length,
				0,
			);
			const annotatedLines = result.value.reduce(
				(acc, s) => acc + s.lines.filter((l) => l.annotations?.length).length,
				0,
			);
			console.log(
				`     ${result.value.length} sections, ${totalLines} lines, ${annotatedLines} annotated\n`,
			);
		} catch (error) {
			console.error(`  ✗ Failed: ${artist} - ${song}`, error);
		}
	}

	console.log("─".repeat(50));
	console.log(
		`Done! ${newCount} new baselines, ${updateCount} timestamped snapshots.`,
	);

	if (updateCount > 0) {
		console.log(`\n💡 To compare old vs new:`);
		console.log(
			`   diff snapshots/<song>.json snapshots/<song>_${timestamp}.json`,
		);
		console.log(`\n   To replace baseline with new snapshot:`);
		console.log(
			`   mv snapshots/<song>_${timestamp}.json snapshots/<song>.json`,
		);
	}
}

generateSnapshots();

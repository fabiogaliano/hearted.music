/**
 * Lyrics Parser Validation Tests
 *
 * Validates that our HTML parsing logic still correctly extracts lyrics
 * from Genius pages. These tests fetch LIVE data and compare against
 * saved snapshots to detect:
 *
 * 1. Parser regressions - Our code broke something
 * 2. Genius HTML changes - Their page structure changed
 *
 * SKIPPED BY DEFAULT - These hit the real Genius API.
 * Run explicitly with: PARSER_VALIDATION=true bun test lyrics-service.integration
 *
 * To regenerate snapshots after intentional changes:
 *   bun run lyrics:snapshot
 */

import { Result } from "better-result";
import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { beforeAll, describe, expect, test } from "vitest";

import { GeniusConfigError, type GeniusError, LyricsService } from "../service";
import type { TransformedLyricsBySection } from "../utils/lyrics-transformer";
import type { Snapshot } from "./generate-snapshots";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, "snapshots");
const HAS_TOKEN = !!process.env.GENIUS_CLIENT_TOKEN;
const RUN_VALIDATION = process.env.PARSER_VALIDATION === "true";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function loadSnapshots(): Snapshot[] {
	const files = readdirSync(SNAPSHOTS_DIR).filter(
		(f) => f.endsWith(".json") && !f.includes("_"),
	); // Exclude timestamped files
	return files.map((file) => {
		const content = readFileSync(join(SNAPSHOTS_DIR, file), "utf-8");
		return JSON.parse(content) as Snapshot;
	});
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry<T>(
	fn: () => Promise<Result<T, GeniusError>>,
	retries = 3,
): Promise<Result<T, GeniusError>> {
	let lastError: GeniusError | undefined;
	for (let i = 0; i < retries; i++) {
		const result = await fn();
		if (Result.isOk(result)) {
			return result;
		}
		lastError = result.error;
		if (i < retries - 1) {
			await sleep(1000 * (i + 1)); // Exponential backoff: 1s, 2s, 3s
		}
	}

	return Result.err(lastError ?? new GeniusConfigError("Lyrics fetch failed"));
}

type FetchResult = {
	key: string;
	snapshot: Snapshot;
	result?: TransformedLyricsBySection[];
	error?: GeniusError;
};

async function fetchAllSongs(
	service: LyricsService,
	snapshots: Snapshot[],
): Promise<Map<string, FetchResult>> {
	const results = new Map<string, FetchResult>();

	for (const snapshot of snapshots) {
		const key = `${snapshot.metadata.artist} - ${snapshot.metadata.song}`;
		const result = await fetchWithRetry(() =>
			service.getLyrics(snapshot.metadata.artist, snapshot.metadata.song),
		);
		if (Result.isOk(result)) {
			results.set(key, { key, snapshot, result: result.value });
		} else {
			results.set(key, { key, snapshot, error: result.error });
		}
	}

	return results;
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe.skipIf(!RUN_VALIDATION || !HAS_TOKEN)(
	"Lyrics Parser Validation",
	() => {
		const snapshots = loadSnapshots();
		let results: Map<string, FetchResult>;
		let service: LyricsService;

		beforeAll(async () => {
			service = new LyricsService({
				accessToken: process.env.GENIUS_CLIENT_TOKEN!,
			});

			console.log("\n🔄 Fetching lyrics from Genius API...");
			results = await fetchAllSongs(service, snapshots);

			// Report fetch results
			let successCount = 0;
			let failCount = 0;
			for (const [key, res] of results) {
				if (res.result) {
					successCount++;
					console.log(`   ✓ ${key}`);
				} else {
					failCount++;
					console.log(`   ✗ ${key}: ${res.error?.message}`);
				}
			}
			console.log(`\n   Fetched: ${successCount}/${snapshots.length} songs\n`);
		}, 60000);

		for (const snapshot of snapshots) {
			const key = `${snapshot.metadata.artist} - ${snapshot.metadata.song}`;

			describe(key, () => {
				test("fetch succeeded", () => {
					const res = results.get(key);
					expect(res, `No result for ${key}`).toBeDefined();
					expect(
						res!.error,
						`Fetch failed: ${res!.error?.message}`,
					).toBeUndefined();
					expect(res!.result, "Result is undefined").toBeDefined();
				});

				test("same number of sections", () => {
					const res = results.get(key);
					if (!res?.result) return; // Skip if fetch failed (already reported above)

					expect(res.result.length).toBe(snapshot.result.length);
				});

				test("same section types", () => {
					const res = results.get(key);
					if (!res?.result) return;

					const resultTypes = res.result.map((s) => s.type);
					const snapshotTypes = snapshot.result.map((s) => s.type);
					expect(resultTypes).toEqual(snapshotTypes);
				});

				test("same line counts per section", () => {
					const res = results.get(key);
					if (!res?.result) return;

					for (let i = 0; i < snapshot.result.length; i++) {
						expect(
							res.result[i]?.lines.length,
							`Section ${i} (${snapshot.result[i].type}) line count mismatch`,
						).toBe(snapshot.result[i].lines.length);
					}
				});

				test("same line text content", () => {
					const res = results.get(key);
					if (!res?.result) return;

					for (let i = 0; i < snapshot.result.length; i++) {
						for (let j = 0; j < snapshot.result[i].lines.length; j++) {
							expect(
								res.result[i]?.lines[j]?.text,
								`Section ${i} (${snapshot.result[i].type}), Line ${j} mismatch`,
							).toBe(snapshot.result[i].lines[j].text);
						}
					}
				});

				test("annotations present on same lines", () => {
					const res = results.get(key);
					if (!res?.result) return;

					for (let i = 0; i < snapshot.result.length; i++) {
						for (let j = 0; j < snapshot.result[i].lines.length; j++) {
							const snapshotHasAnnotation =
								(snapshot.result[i].lines[j].annotations?.length ?? 0) > 0;
							const resultHasAnnotation =
								(res.result[i]?.lines[j]?.annotations?.length ?? 0) > 0;

							expect(
								resultHasAnnotation,
								`Section ${i}, Line ${j} annotation presence mismatch`,
							).toBe(snapshotHasAnnotation);
						}
					}
				});
			});
		}
	},
);

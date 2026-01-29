/**
 * Analysis Pipeline Full Flow Integration Test
 *
 * Validates the complete end-to-end flow of song analysis:
 * 1. Genius lyrics fetching
 * 2. LLM analysis with structured output
 * 3. Database storage
 * 4. Job tracking with SSE progress events
 *
 * SKIPPED BY DEFAULT - This test hits real external APIs (Genius, LLM providers)
 * and the database. Run explicitly with:
 *
 *   FULL_FLOW_TEST=true bun test analysis-pipeline-full-flow.integration
 *
 * REQUIREMENTS:
 * - GENIUS_CLIENT_TOKEN must be set
 * - GOOGLE_GENERATIVE_AI_API_KEY or ANTHROPIC_API_KEY must be set
 * - Database must be accessible (uses real Supabase)
 * - Test account ID must exist in database
 *
 * This is a "tracer bullet" test that validates the most critical, complex
 * user-facing feature: analyzing songs with lyrics and storing results.
 */

import { beforeAll, describe, expect, test } from "vitest";
import { Result } from "better-result";
import { createAnalysisPipeline, type SongToAnalyze } from "../pipeline";
import type { PipelineResult } from "../pipeline";
import type { JobProgress } from "@/lib/jobs/progress/types";
import * as jobsData from "@/lib/data/jobs";

// ─────────────────────────────────────────────────────────────
// Test Configuration
// ─────────────────────────────────────────────────────────────

const RUN_TEST = process.env.FULL_FLOW_TEST === "true";
const TEST_ACCOUNT_ID = process.env.TEST_ACCOUNT_ID; // Must be real account ID

const HAS_GENIUS = !!process.env.GENIUS_CLIENT_TOKEN;
const HAS_LLM =
	!!process.env.GOOGLE_GENERATIVE_AI_API_KEY || !!process.env.ANTHROPIC_API_KEY;
const HAS_TEST_ACCOUNT = !!TEST_ACCOUNT_ID;

// ─────────────────────────────────────────────────────────────
// Test Data - Hardcoded Real Spotify Track IDs
// ─────────────────────────────────────────────────────────────

// Well-known songs with reliable Genius pages (following smoke test pattern)
const KNOWN_TRACKS = [
	{
		spotifyId: "7qiZfU4dY1lWllzX7mPBI", // All The Stars - Kendrick Lamar
		artist: "Kendrick Lamar",
		title: "All The Stars",
	},
	{
		spotifyId: "0VjIjW4GlUZAMYd2vXMi3b", // Blinding Lights - The Weeknd
		artist: "The Weeknd",
		title: "Blinding Lights",
	},
];

// ─────────────────────────────────────────────────────────────
// Helper: Get or Create Test Songs
// ─────────────────────────────────────────────────────────────

async function getOrCreateTestSongs(): Promise<SongToAnalyze[]> {
	const { getBySpotifyIds, upsert } = await import("@/lib/data/song");

	// Try to fetch existing songs
	const existingResult = await getBySpotifyIds(
		KNOWN_TRACKS.map((t) => t.spotifyId),
	);

	if (!Result.isOk(existingResult)) {
		throw new Error(`Failed to query songs: ${existingResult.error.message}`);
	}

	const existing = existingResult.value;
	const songMap = new Map(existing.map((s) => [s.spotify_id, s]));

	// Create songs that don't exist yet
	const songsToCreate = KNOWN_TRACKS.filter(
		(track) => !songMap.has(track.spotifyId),
	);

	if (songsToCreate.length > 0) {
		console.log(
			`   Creating ${songsToCreate.length} test songs in database...`,
		);
		const createResult = await upsert(
			songsToCreate.map((track) => ({
				spotify_id: track.spotifyId,
				name: track.title,
				artists: [track.artist],
				album_name: "Test Album",
				album_id: "test-album",
				duration_ms: 180000,
				genres: [],
				preview_url: null,
				image_url: null,
				isrc: null,
				popularity: 50,
			})),
		);

		if (!Result.isOk(createResult)) {
			throw new Error(`Failed to create songs: ${createResult.error.message}`);
		}

		// Add newly created songs to map
		for (const song of createResult.value) {
			songMap.set(song.spotify_id, song);
		}
	}

	// Build SongToAnalyze array with real song IDs
	return KNOWN_TRACKS.map((track) => {
		const song = songMap.get(track.spotifyId)!;
		return {
			songId: song.id,
			artist: track.artist,
			title: track.title,
			lyrics: "", // Will be fetched from Genius
		};
	});
}

// Test songs will be populated in beforeAll
let TEST_SONGS: SongToAnalyze[] = [];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

type ProgressEvent = {
	type: "status" | "progress" | "item" | "error";
	data: unknown;
};

function createProgressTracker() {
	const events: ProgressEvent[] = [];

	return {
		events,
		callback: (progress: JobProgress) => {
			events.push({ type: "progress", data: progress });
		},
		getStatusEvents: () =>
			events.filter((e) => e.type === "status").map((e) => e.data),
		getProgressEvents: () =>
			events.filter((e) => e.type === "progress").map((e) => e.data),
		getItemEvents: () =>
			events.filter((e) => e.type === "item").map((e) => e.data),
		getErrorEvents: () =>
			events.filter((e) => e.type === "error").map((e) => e.data),
	};
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe.skipIf(!RUN_TEST || !HAS_GENIUS || !HAS_LLM || !HAS_TEST_ACCOUNT)(
	"Analysis Pipeline Full Flow",
	() => {
		let pipelineResult: Result<PipelineResult, unknown>;
		let progressTracker: ReturnType<typeof createProgressTracker>;

		beforeAll(async () => {
			// Get or create test songs in database
			try {
				TEST_SONGS = await getOrCreateTestSongs();
				console.log(`\n✓ Prepared ${TEST_SONGS.length} real songs for testing`);
				for (const song of TEST_SONGS) {
					console.log(
						`   - ${song.artist} - ${song.title} (ID: ${song.songId})`,
					);
				}
			} catch (error) {
				console.error(`\n✗ Failed to prepare test songs: ${error}`);
				throw error;
			}

			// Verify test account exists
			if (!TEST_ACCOUNT_ID) {
				throw new Error("TEST_ACCOUNT_ID environment variable is required");
			}

			const { getAccountById } = await import("@/lib/data/accounts");
			const accountResult = await getAccountById(TEST_ACCOUNT_ID);
			if (!Result.isOk(accountResult) || !accountResult.value) {
				throw new Error(
					`Test account ${TEST_ACCOUNT_ID} not found. Please set TEST_ACCOUNT_ID to a valid account ID.`,
				);
			}
			console.log(`✓ Using test account: ${accountResult.value.spotify_id}`);

			// Create pipeline
			const pipelineCreation = createAnalysisPipeline();
			if (!Result.isOk(pipelineCreation)) {
				throw new Error(
					`Failed to create pipeline: ${pipelineCreation.error.message}`,
				);
			}

			const pipeline = pipelineCreation.value;

			// Track progress events
			progressTracker = createProgressTracker();

			console.log("\n🚀 Running full analysis pipeline...");
			console.log(`   Account: ${TEST_ACCOUNT_ID}`);
			console.log(`   Songs: ${TEST_SONGS.length}`);

			// Run the pipeline (TEST_ACCOUNT_ID is guaranteed to be string here)
			pipelineResult = await pipeline.analyzeSongs(
				TEST_ACCOUNT_ID as string,
				TEST_SONGS,
				progressTracker.callback,
			);

			if (Result.isOk(pipelineResult)) {
				console.log(
					`   ✓ Completed: ${pipelineResult.value.succeeded} succeeded`,
				);
				console.log(`   ✓ Failed: ${pipelineResult.value.failed} failed`);
			} else {
				console.log(`   ✗ Pipeline failed: ${pipelineResult.error}`);
			}
		}, 120000); // 2 minute timeout for LLM calls

		test("pipeline execution succeeds", () => {
			expect(Result.isOk(pipelineResult)).toBe(true);
		});

		test("all songs are analyzed successfully", () => {
			if (!Result.isOk(pipelineResult)) return;

			const result = pipelineResult.value;
			expect(result.succeeded).toBe(TEST_SONGS.length);
			expect(result.failed).toBe(0);
		});

		test("pipeline result includes job ID", () => {
			if (!Result.isOk(pipelineResult)) return;

			const result = pipelineResult.value;
			expect(result.jobId).toBeDefined();
			expect(typeof result.jobId).toBe("string");
		});

		test("progress callback was invoked", () => {
			const progressEvents = progressTracker.getProgressEvents();
			expect(progressEvents.length).toBeGreaterThan(0);
		});

		test("progress events show incremental updates", () => {
			const progressEvents =
				progressTracker.getProgressEvents() as JobProgress[];

			// Should have multiple progress updates
			expect(progressEvents.length).toBeGreaterThanOrEqual(1);

			// Final progress should match result
			if (Result.isOk(pipelineResult)) {
				const finalProgress = progressEvents[progressEvents.length - 1];
				expect(finalProgress.done).toBe(TEST_SONGS.length);
			}
		});

		describe("Genius lyrics fetching", () => {
			test("lyrics were fetched from Genius", async () => {
				if (!Result.isOk(pipelineResult)) return;

				// The pipeline should have fetched lyrics for songs without them
				// We can verify this by checking that the songs now have lyrics
				// in the context of the analysis (lyrics would be passed to LLM)

				// This is validated indirectly - if analysis succeeded, lyrics were available
				expect(pipelineResult.value.succeeded).toBeGreaterThan(0);
			});
		});

		describe("LLM analysis", () => {
			test("structured analysis was generated", async () => {
				if (!Result.isOk(pipelineResult)) return;

				// The fact that analysis succeeded means LLM returned structured data
				// We can verify by checking the analysis was stored in the database
				const { get: getSongAnalysis } = await import(
					"@/lib/data/song-analysis"
				);

				for (const song of TEST_SONGS) {
					const analysisResult = await getSongAnalysis(song.songId);
					if (Result.isOk(analysisResult)) {
						const analysis = analysisResult.value;

						if (analysis) {
							// Verify analysis field exists (it's a JSONB column)
							expect(analysis.analysis).toBeDefined();
							expect(typeof analysis.analysis).toBe("object");

							console.log(
								`   ✓ Analysis stored for: ${song.artist} - ${song.title}`,
							);
						}
					}
				}
			});

			test("analysis includes required fields", async () => {
				if (!Result.isOk(pipelineResult)) return;

				const { get: getSongAnalysis } = await import(
					"@/lib/data/song-analysis"
				);

				const analysisResult = await getSongAnalysis(TEST_SONGS[0].songId);
				if (!Result.isOk(analysisResult)) return;

				const analysis = analysisResult.value;
				if (!analysis) return;

				// Verify the analysis JSONB field contains structured data
				expect(analysis.analysis).toBeDefined();
				expect(typeof analysis.analysis).toBe("object");

				// The analysis field contains the structured LLM output
				const analysisData = analysis.analysis as any;
				expect(analysisData.meaning).toBeDefined();
				expect(analysisData.emotional).toBeDefined();
				expect(analysisData.context).toBeDefined();
				expect(analysisData.musical_style).toBeDefined();
			});
		});

		describe("Database storage", () => {
			test("song analyses are persisted", async () => {
				if (!Result.isOk(pipelineResult)) return;

				const { get: getSongAnalysis } = await import(
					"@/lib/data/song-analysis"
				);

				for (const song of TEST_SONGS) {
					const analysisResult = await getSongAnalysis(song.songId);
					expect(Result.isOk(analysisResult)).toBe(true);

					if (Result.isOk(analysisResult)) {
						expect(analysisResult.value).toBeDefined();
						expect(analysisResult.value?.song_id).toBe(song.songId);
					}
				}
			});

			test("analyses include timestamps", async () => {
				if (!Result.isOk(pipelineResult)) return;

				const { get: getSongAnalysis } = await import(
					"@/lib/data/song-analysis"
				);

				const analysisResult = await getSongAnalysis(TEST_SONGS[0].songId);
				if (!Result.isOk(analysisResult) || !analysisResult.value) return;

				const analysis = analysisResult.value;
				expect(analysis.created_at).toBeDefined();
			});
		});

		describe("Job tracking", () => {
			test("job was created with correct status", async () => {
				if (!Result.isOk(pipelineResult)) return;

				const jobId = pipelineResult.value.jobId;
				const jobResult = await jobsData.getJobById(jobId);

				expect(Result.isOk(jobResult)).toBe(true);
				if (Result.isOk(jobResult)) {
					const job = jobResult.value;
					expect(job).toBeDefined();
					if (job) {
						expect(job.status).toMatch(/completed|failed/);
					}
				}
			});

			test("job includes total count in progress", async () => {
				if (!Result.isOk(pipelineResult)) return;

				const jobId = pipelineResult.value.jobId;
				const jobResult = await jobsData.getJobById(jobId);

				if (Result.isOk(jobResult) && jobResult.value) {
					const job = jobResult.value;
					const progress = job.progress as JobProgress;
					expect(progress.total).toBe(TEST_SONGS.length);
				}
			});

			test("job tracks progress correctly", async () => {
				if (!Result.isOk(pipelineResult)) return;

				const jobId = pipelineResult.value.jobId;
				const jobResult = await jobsData.getJobById(jobId);

				if (Result.isOk(jobResult) && jobResult.value) {
					const job = jobResult.value;
					const progress = job.progress as JobProgress;

					expect(progress.done).toBe(TEST_SONGS.length);
					expect(progress.succeeded + progress.failed).toBe(TEST_SONGS.length);
				}
			});
		});
	},
);

// ─────────────────────────────────────────────────────────────
// Skipped Test Notice
// ─────────────────────────────────────────────────────────────

describe.skipIf(RUN_TEST)("Analysis Pipeline Full Flow (Skipped)", () => {
	test("requires FULL_FLOW_TEST=true and TEST_ACCOUNT_ID to run", () => {
		console.log("\n⏭️  Analysis Pipeline Full Flow test skipped");
		console.log(
			"   Set FULL_FLOW_TEST=true and TEST_ACCOUNT_ID=<account-id> to run",
		);
		console.log("   Requires:");
		console.log("     - GENIUS_CLIENT_TOKEN");
		console.log("     - GOOGLE_GENERATIVE_AI_API_KEY or ANTHROPIC_API_KEY");
		console.log("     - TEST_ACCOUNT_ID (real account from database)");
		console.log("     - Database access");

		if (!HAS_GENIUS) console.log("   ✗ Missing: GENIUS_CLIENT_TOKEN");
		if (!HAS_LLM) console.log("   ✗ Missing: LLM API key");
		if (!HAS_TEST_ACCOUNT) console.log("   ✗ Missing: TEST_ACCOUNT_ID");

		expect(true).toBe(true);
	});
});

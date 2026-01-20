/**
 * Pipeline Lyrics Integration Test
 *
 * Tests that the AnalysisPipeline correctly prefetches lyrics
 * and passes them to SongAnalysisService.
 *
 * Uses mocked LyricsService to avoid hitting the Genius API.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { Result } from "better-result";

// Mock the lyrics service module with real GeniusNotFoundError for error testing
vi.mock("@/lib/services/lyrics/service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/services/lyrics/service")>();
	return {
		...actual,
		LyricsService: vi.fn().mockImplementation(() => ({
			getLyricsText: vi.fn(),
		})),
	};
});

// Mock data modules to avoid DB calls
vi.mock("@/lib/data/jobs", () => ({
	createJob: vi.fn().mockResolvedValue(
		Result.ok({ id: "test-job-123", status: "pending" }),
	),
	updateJobProgress: vi.fn().mockResolvedValue(Result.ok(undefined)),
	updateJobStatus: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

vi.mock("@/lib/services/job-lifecycle", () => ({
	startJob: vi.fn().mockResolvedValue(Result.ok(undefined)),
	finalizeJob: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

vi.mock("@/lib/data/song-audio-feature", () => ({
	getBatch: vi.fn().mockResolvedValue(Result.ok(new Map())),
}));

// Mock LLM service
vi.mock("@/lib/services/llm/service", () => ({
	LlmService: vi.fn().mockImplementation(() => ({})),
}));

// Mock song analysis service
vi.mock("../song-analysis", () => ({
	SongAnalysisService: vi.fn().mockImplementation(() => ({
		analyzeSong: vi.fn().mockResolvedValue(
			Result.ok({ themes: ["test"], mood: "happy" }),
		),
	})),
}));

// Mock playlist analysis service
vi.mock("../playlist-analysis", () => ({
	PlaylistAnalysisService: vi.fn().mockImplementation(() => ({})),
}));

import { LyricsService } from "@/lib/services/lyrics/service";
import type { SongToAnalyze } from "../pipeline";

describe("Pipeline Lyrics Integration", () => {
	let mockGetLyricsText: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();

		// Set up the mock lyrics service
		mockGetLyricsText = vi.fn();
		(LyricsService as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			() => ({
				getLyricsText: mockGetLyricsText,
			}),
		);

		// Set required env vars
		process.env.GENIUS_CLIENT_TOKEN = "test-token";
		process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
	});

	/** Helper to unwrap pipeline Result or fail test */
	const unwrapPipeline = async () => {
		const { createAnalysisPipeline } = await import("../pipeline");
		const result = createAnalysisPipeline();
		if (!Result.isOk(result)) {
			throw new Error(`Failed to create pipeline: ${result.error.message}`);
		}
		return result.value;
	};

	describe("prefetchLyrics behavior", () => {
		it("fetches lyrics for songs without existing lyrics", async () => {
			mockGetLyricsText
				.mockResolvedValueOnce(Result.ok("Lyrics for song 1"))
				.mockResolvedValueOnce(Result.ok("Lyrics for song 2"));

			const pipeline = await unwrapPipeline();

			const songs: SongToAnalyze[] = [
				{ songId: "1", artist: "Artist 1", title: "Song 1", lyrics: "" },
				{ songId: "2", artist: "Artist 2", title: "Song 2", lyrics: "" },
			];

			await pipeline.analyzeSongs("account-123", songs);

			// Should have fetched lyrics for both songs
			expect(mockGetLyricsText).toHaveBeenCalledTimes(2);
			expect(mockGetLyricsText).toHaveBeenCalledWith("Artist 1", "Song 1");
			expect(mockGetLyricsText).toHaveBeenCalledWith("Artist 2", "Song 2");
		});

		it("skips fetching for songs that already have lyrics", async () => {
			const pipeline = await unwrapPipeline();

			const songs: SongToAnalyze[] = [
				{
					songId: "1",
					artist: "Artist 1",
					title: "Song 1",
					lyrics: "Existing lyrics here",
				},
				{ songId: "2", artist: "Artist 2", title: "Song 2", lyrics: "" },
			];

			mockGetLyricsText.mockResolvedValueOnce(
				Result.ok("Fetched lyrics for song 2"),
			);

			await pipeline.analyzeSongs("account-123", songs);

			// Should only fetch for song without lyrics
			expect(mockGetLyricsText).toHaveBeenCalledTimes(1);
			expect(mockGetLyricsText).toHaveBeenCalledWith("Artist 2", "Song 2");
		});

		it("handles lyrics fetch failure gracefully", async () => {
			const { GeniusNotFoundError } = await import("@/lib/services/lyrics/service");

			mockGetLyricsText.mockResolvedValueOnce(
				Result.err(new GeniusNotFoundError("Artist 1", "Song 1")),
			);

			const pipeline = await unwrapPipeline();

			const songs: SongToAnalyze[] = [
				{ songId: "1", artist: "Artist 1", title: "Song 1", lyrics: "" },
			];

			// Should not throw - failures are recorded, not thrown
			const result = await pipeline.analyzeSongs("account-123", songs);

			expect(Result.isOk(result)).toBe(true);
			if (Result.isOk(result)) {
				// Song should be counted as failed (no lyrics)
				expect(result.value.failed).toBe(1);
				expect(result.value.succeeded).toBe(0);
			}
		});

		it("skips prefetch when GENIUS_CLIENT_TOKEN not set", async () => {
			delete process.env.GENIUS_CLIENT_TOKEN;

			// Re-import to get fresh instance without lyrics service
			vi.resetModules();

			const pipeline = await unwrapPipeline();

			const songs: SongToAnalyze[] = [
				{ songId: "1", artist: "Artist 1", title: "Song 1", lyrics: "" },
			];

			// Mock console.warn to verify warning is logged
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			await pipeline.analyzeSongs("account-123", songs);

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("GENIUS_CLIENT_TOKEN not set"),
			);
			warnSpy.mockRestore();
		});
	});

	describe("lyrics passed to analysis", () => {
		it("uses prefetched lyrics in analysis input", async () => {
			const { SongAnalysisService } = await import("../song-analysis");

			const mockAnalyzeSong = vi.fn().mockResolvedValue(
				Result.ok({ themes: ["love"], mood: "romantic" }),
			);
			(
				SongAnalysisService as unknown as ReturnType<typeof vi.fn>
			).mockImplementation(() => ({
				analyzeSong: mockAnalyzeSong,
			}));

			mockGetLyricsText.mockResolvedValueOnce(
				Result.ok("Prefetched lyrics content"),
			);

			const pipeline = await unwrapPipeline();
			const songs: SongToAnalyze[] = [
				{ songId: "1", artist: "Artist", title: "Song", lyrics: "" },
			];

			await pipeline.analyzeSongs("account-123", songs);

			// Verify lyrics were passed to analyzeSong
			expect(mockAnalyzeSong).toHaveBeenCalledWith(
				expect.objectContaining({
					songId: "1",
					lyrics: "Prefetched lyrics content",
				}),
			);
		});

		it("uses existing lyrics if provided (no prefetch)", async () => {
			const { SongAnalysisService } = await import("../song-analysis");

			const mockAnalyzeSong = vi.fn().mockResolvedValue(
				Result.ok({ themes: ["test"], mood: "happy" }),
			);
			(
				SongAnalysisService as unknown as ReturnType<typeof vi.fn>
			).mockImplementation(() => ({
				analyzeSong: mockAnalyzeSong,
			}));

			const pipeline = await unwrapPipeline();
			const songs: SongToAnalyze[] = [
				{
					songId: "1",
					artist: "Artist",
					title: "Song",
					lyrics: "Original lyrics",
				},
			];

			await pipeline.analyzeSongs("account-123", songs);

			// Should use the original lyrics, not fetch new ones
			expect(mockGetLyricsText).not.toHaveBeenCalled();
			expect(mockAnalyzeSong).toHaveBeenCalledWith(
				expect.objectContaining({
					lyrics: "Original lyrics",
				}),
			);
		});
	});
});

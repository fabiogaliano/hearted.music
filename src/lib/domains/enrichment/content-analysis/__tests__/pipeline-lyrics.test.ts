/**
 * Pipeline Lyrics Integration Test
 *
 * Tests that the AnalysisPipeline correctly prefetches lyrics
 * and passes them to SongAnalysisService.
 *
 * Uses mocked LyricsService to avoid hitting the Genius API.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@/env` is frozen at module load, so mutating process.env can't toggle the
// token; mock it with a Proxy over a mutable object instead.
const mockEnv: { GENIUS_CLIENT_TOKEN: string | undefined } = {
	GENIUS_CLIENT_TOKEN: undefined,
};

vi.mock("@/env", () => ({
	env: new Proxy(
		{},
		{
			get: (_target, prop) =>
				typeof prop === "string"
					? mockEnv[prop as keyof typeof mockEnv]
					: undefined,
		},
	),
}));

// Mock the lyrics service module while preserving real Genius error classes
// re-exported through it.
vi.mock("@/lib/domains/enrichment/lyrics/service", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("@/lib/domains/enrichment/lyrics/service")
		>();
	return {
		...actual,
		LyricsService: vi.fn().mockImplementation(function () {
			return { fetchAndStoreLyrics: vi.fn() };
		}),
	};
});

// Mock data modules to avoid DB calls
vi.mock("@/lib/platform/jobs/repository", () => ({
	createJob: vi
		.fn()
		.mockResolvedValue(Result.ok({ id: "test-job-123", status: "pending" })),
	updateJobProgress: vi.fn().mockResolvedValue(Result.ok(undefined)),
	updateJobStatus: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

vi.mock("@/lib/platform/jobs/lifecycle", () => ({
	startJob: vi.fn().mockResolvedValue(Result.ok(undefined)),
	finalizeJob: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

vi.mock("@/lib/domains/enrichment/audio-features/queries", () => ({
	getBatch: vi.fn().mockResolvedValue(Result.ok(new Map())),
}));

import type { AudioFeature } from "@/lib/domains/enrichment/audio-features/queries";
import { getBatch as getAudioFeaturesBatch } from "@/lib/domains/enrichment/audio-features/queries";

function audioFeatureFor(songId: string): AudioFeature {
	const now = new Date().toISOString();
	return {
		id: `af-${songId}`,
		song_id: songId,
		acousticness: 0.1,
		danceability: 0.5,
		energy: 0.6,
		instrumentalness: 0.0,
		key: 0,
		liveness: 0.1,
		loudness: -8.0,
		mode: 1,
		speechiness: 0.05,
		tempo: 120,
		time_signature: 4,
		valence: 0.5,
		created_at: now,
		updated_at: now,
	};
}

vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: vi.fn().mockResolvedValue(Result.ok([])),
}));

// Mock LLM service
vi.mock("@/lib/integrations/llm/service", () => ({
	LlmService: vi.fn().mockImplementation(function () {
		return {};
	}),
}));

// Mock LLM config so the pipeline's provider precondition is satisfied without
// reading the validated env schema (which guards server vars in jsdom tests).
vi.mock("@/lib/integrations/llm/config", () => ({
	resolveLlmConfig: vi.fn().mockReturnValue({
		ok: true,
		config: {
			provider: "google-vertex",
			project: "test-project",
			location: "us-central1",
		},
	}),
}));

// Mock song analysis service
vi.mock("../song-analysis", () => ({
	SongAnalysisService: vi.fn().mockImplementation(function () {
		return {
			analyzeSong: vi
				.fn()
				.mockResolvedValue(Result.ok({ themes: ["test"], mood: "happy" })),
		};
	}),
}));

// Mock playlist analysis service
vi.mock("../playlist-analysis", () => ({
	PlaylistAnalysisService: vi.fn().mockImplementation(function () {
		return {};
	}),
}));

import { LyricsService } from "@/lib/domains/enrichment/lyrics/service";
import type { SongToAnalyze } from "../pipeline";

describe("Pipeline Lyrics Integration", () => {
	let mockFetchAndStoreLyrics: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();

		// Set up the mock lyrics service
		mockFetchAndStoreLyrics = vi.fn();
		(LyricsService as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			function () {
				return { fetchAndStoreLyrics: mockFetchAndStoreLyrics };
			},
		);

		// Genius token is read via the mocked `@/env` snapshot; the LLM config is
		// supplied by the mocked resolveLlmConfig above.
		mockEnv.GENIUS_CLIENT_TOKEN = "test-token";
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
			mockFetchAndStoreLyrics
				.mockResolvedValueOnce(Result.ok("Lyrics for song 1"))
				.mockResolvedValueOnce(Result.ok("Lyrics for song 2"));

			const pipeline = await unwrapPipeline();

			const songs: SongToAnalyze[] = [
				{ songId: "1", artist: "Artist 1", title: "Song 1", lyrics: "" },
				{ songId: "2", artist: "Artist 2", title: "Song 2", lyrics: "" },
			];

			await pipeline.analyzeSongs("account-123", songs);

			// Should have fetched lyrics for both songs
			expect(mockFetchAndStoreLyrics).toHaveBeenCalledTimes(2);
			expect(mockFetchAndStoreLyrics).toHaveBeenCalledWith(
				"1",
				"Artist 1",
				"Song 1",
				expect.objectContaining({ distiller: expect.any(Function) }),
			);
			expect(mockFetchAndStoreLyrics).toHaveBeenCalledWith(
				"2",
				"Artist 2",
				"Song 2",
				expect.objectContaining({ distiller: expect.any(Function) }),
			);
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

			mockFetchAndStoreLyrics.mockResolvedValueOnce(
				Result.ok("Fetched lyrics for song 2"),
			);

			await pipeline.analyzeSongs("account-123", songs);

			// Should only fetch for song without lyrics
			expect(mockFetchAndStoreLyrics).toHaveBeenCalledTimes(1);
			expect(mockFetchAndStoreLyrics).toHaveBeenCalledWith(
				"2",
				"Artist 2",
				"Song 2",
				expect.objectContaining({ distiller: expect.any(Function) }),
			);
		});

		it("handles lyrics fetch failure gracefully when audio features exist", async () => {
			const { GeniusNotFoundError } = await import(
				"@/lib/shared/errors/external/genius"
			);

			mockFetchAndStoreLyrics.mockResolvedValueOnce(
				Result.err(new GeniusNotFoundError("Artist 1", "Song 1")),
			);
			vi.mocked(getAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(new Map([["1", audioFeatureFor("1")]])),
			);

			const pipeline = await unwrapPipeline();

			const songs: SongToAnalyze[] = [
				{ songId: "1", artist: "Artist 1", title: "Song 1", lyrics: "" },
			];

			const result = await pipeline.analyzeSongs("account-123", songs);

			expect(Result.isOk(result)).toBe(true);
			if (Result.isOk(result)) {
				expect(result.value.succeeded).toBe(1);
				expect(result.value.failed).toBe(0);
				expect(result.value.skippedConfirmedInputsMissing).toEqual([]);
				expect(result.value.skippedUnconfirmedLyrics).toEqual([]);
				expect(result.value.skippedUnconfirmedAudio).toEqual([]);
				expect(result.value.skippedUnconfirmedBoth).toEqual([]);
			}
		});

		it("skips prefetch when GENIUS_CLIENT_TOKEN not set", async () => {
			mockEnv.GENIUS_CLIENT_TOKEN = undefined;

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

			const mockAnalyzeSong = vi
				.fn()
				.mockResolvedValue(Result.ok({ themes: ["love"], mood: "romantic" }));
			(
				SongAnalysisService as unknown as ReturnType<typeof vi.fn>
			).mockImplementation(function () {
				return { analyzeSong: mockAnalyzeSong };
			});

			mockFetchAndStoreLyrics.mockResolvedValueOnce(
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

			const mockAnalyzeSong = vi
				.fn()
				.mockResolvedValue(Result.ok({ themes: ["test"], mood: "happy" }));
			(
				SongAnalysisService as unknown as ReturnType<typeof vi.fn>
			).mockImplementation(function () {
				return { analyzeSong: mockAnalyzeSong };
			});

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
			expect(mockFetchAndStoreLyrics).not.toHaveBeenCalled();
			expect(mockAnalyzeSong).toHaveBeenCalledWith(
				expect.objectContaining({
					lyrics: "Original lyrics",
				}),
			);
		});
	});

	describe("analysis-input gate (tri-state evidence)", () => {
		const mockNoAnalyze = () =>
			vi.fn().mockResolvedValue(Result.ok({ themes: ["x"], mood: "y" }));

		async function withMockAnalyzer(): Promise<ReturnType<typeof vi.fn>> {
			const { SongAnalysisService } = await import("../song-analysis");
			const mockAnalyzeSong = mockNoAnalyze();
			(
				SongAnalysisService as unknown as ReturnType<typeof vi.fn>
			).mockImplementation(function () {
				return { analyzeSong: mockAnalyzeSong };
			});
			return mockAnalyzeSong;
		}

		it("Genius not_found + audio confirmed missing => terminal confirmed missing", async () => {
			const { GeniusNotFoundError } = await import(
				"@/lib/shared/errors/external/genius"
			);
			const mockAnalyzeSong = vi.fn();
			const { SongAnalysisService } = await import("../song-analysis");
			(
				SongAnalysisService as unknown as ReturnType<typeof vi.fn>
			).mockImplementation(function () {
				return { analyzeSong: mockAnalyzeSong };
			});

			mockFetchAndStoreLyrics.mockResolvedValueOnce(
				Result.err(new GeniusNotFoundError("A", "T")),
			);
			vi.mocked(getAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(new Map()),
			);

			const pipeline = await unwrapPipeline();
			const result = await pipeline.analyzeSongs("account-123", [
				{ songId: "skip-me", artist: "A", title: "T", lyrics: "" },
			]);

			expect(mockAnalyzeSong).not.toHaveBeenCalled();
			if (Result.isOk(result)) {
				expect(result.value.skippedConfirmedInputsMissing).toEqual(["skip-me"]);
				expect(result.value.skippedUnconfirmedLyrics).toEqual([]);
				expect(result.value.skippedUnconfirmedAudio).toEqual([]);
				expect(result.value.skippedUnconfirmedBoth).toEqual([]);
				expect(result.value.failed).toBe(1);
				expect(result.value.total).toBe(1);
			}
		});

		it("analyzes when only lyrics are available (no audio features row)", async () => {
			const mockAnalyzeSong = await withMockAnalyzer();

			mockFetchAndStoreLyrics.mockResolvedValueOnce(
				Result.ok("Some lyrics here"),
			);
			vi.mocked(getAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(new Map()),
			);

			const pipeline = await unwrapPipeline();
			const result = await pipeline.analyzeSongs("account-123", [
				{ songId: "lyrics-only", artist: "A", title: "T", lyrics: "" },
			]);

			expect(mockAnalyzeSong).toHaveBeenCalledOnce();
			expect(mockAnalyzeSong).toHaveBeenCalledWith(
				expect.objectContaining({
					songId: "lyrics-only",
					lyrics: "Some lyrics here",
				}),
			);
			if (Result.isOk(result)) {
				expect(result.value.skippedConfirmedInputsMissing).toEqual([]);
				expect(result.value.skippedUnconfirmedLyrics).toEqual([]);
				expect(result.value.skippedUnconfirmedAudio).toEqual([]);
				expect(result.value.skippedUnconfirmedBoth).toEqual([]);
				expect(result.value.succeeded).toBe(1);
			}
		});

		it("analyzes when only audio features are available (no lyrics)", async () => {
			const { GeniusNotFoundError } = await import(
				"@/lib/shared/errors/external/genius"
			);
			const mockAnalyzeSong = await withMockAnalyzer();

			mockFetchAndStoreLyrics.mockResolvedValueOnce(
				Result.err(new GeniusNotFoundError("A", "T")),
			);
			vi.mocked(getAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(new Map([["audio-only", audioFeatureFor("audio-only")]])),
			);

			const pipeline = await unwrapPipeline();
			const result = await pipeline.analyzeSongs("account-123", [
				{ songId: "audio-only", artist: "A", title: "T", lyrics: "" },
			]);

			expect(mockAnalyzeSong).toHaveBeenCalledOnce();
			expect(mockAnalyzeSong).toHaveBeenCalledWith(
				expect.objectContaining({
					songId: "audio-only",
					audioFeatures: expect.objectContaining({ tempo: 120 }),
				}),
			);
			if (Result.isOk(result)) {
				expect(result.value.skippedConfirmedInputsMissing).toEqual([]);
				expect(result.value.skippedUnconfirmedLyrics).toEqual([]);
				expect(result.value.skippedUnconfirmedAudio).toEqual([]);
				expect(result.value.skippedUnconfirmedBoth).toEqual([]);
				expect(result.value.succeeded).toBe(1);
			}
		});

		it("Genius not_found + audio query errored => unconfirmed_audio (non-terminal)", async () => {
			const { GeniusNotFoundError } = await import(
				"@/lib/shared/errors/external/genius"
			);
			const { DatabaseError } = await import("@/lib/shared/errors/database");
			const mockAnalyzeSong = vi.fn();
			const { SongAnalysisService } = await import("../song-analysis");
			(
				SongAnalysisService as unknown as ReturnType<typeof vi.fn>
			).mockImplementation(function () {
				return { analyzeSong: mockAnalyzeSong };
			});

			mockFetchAndStoreLyrics.mockResolvedValueOnce(
				Result.err(new GeniusNotFoundError("A", "T")),
			);
			vi.mocked(getAudioFeaturesBatch).mockResolvedValueOnce(
				Result.err(
					new DatabaseError({ code: "TIMEOUT", message: "audio failed" }),
				),
			);

			const pipeline = await unwrapPipeline();
			const result = await pipeline.analyzeSongs("account-123", [
				{ songId: "audio-down", artist: "A", title: "T", lyrics: "" },
			]);

			expect(mockAnalyzeSong).not.toHaveBeenCalled();
			if (Result.isOk(result)) {
				expect(result.value.skippedConfirmedInputsMissing).toEqual([]);
				expect(result.value.skippedUnconfirmedLyrics).toEqual([]);
				expect(result.value.skippedUnconfirmedAudio).toEqual(["audio-down"]);
				expect(result.value.skippedUnconfirmedBoth).toEqual([]);
				expect(result.value.failed).toBe(1);
			}
		});

		it("no Genius token + audio confirmed missing => unconfirmed_lyrics (non-terminal, NOT terminal missing)", async () => {
			mockEnv.GENIUS_CLIENT_TOKEN = undefined;
			vi.resetModules();

			const { SongAnalysisService } = await import("../song-analysis");
			const mockAnalyzeSong = vi.fn();
			(
				SongAnalysisService as unknown as ReturnType<typeof vi.fn>
			).mockImplementation(function () {
				return { analyzeSong: mockAnalyzeSong };
			});
			vi.mocked(getAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(new Map()),
			);

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const pipeline = await unwrapPipeline();
			const result = await pipeline.analyzeSongs("account-123", [
				{ songId: "no-token", artist: "A", title: "T", lyrics: "" },
			]);

			expect(mockAnalyzeSong).not.toHaveBeenCalled();
			if (Result.isOk(result)) {
				expect(result.value.skippedConfirmedInputsMissing).toEqual([]);
				expect(result.value.skippedUnconfirmedLyrics).toEqual(["no-token"]);
				expect(result.value.skippedUnconfirmedAudio).toEqual([]);
				expect(result.value.skippedUnconfirmedBoth).toEqual([]);
				expect(result.value.failed).toBe(1);
			}
			warnSpy.mockRestore();
		});

		it("Genius fetch error + audio confirmed missing => unconfirmed_lyrics (non-terminal)", async () => {
			const { GeniusFetchError } = await import(
				"@/lib/shared/errors/external/genius"
			);
			const mockAnalyzeSong = vi.fn();
			const { SongAnalysisService } = await import("../song-analysis");
			(
				SongAnalysisService as unknown as ReturnType<typeof vi.fn>
			).mockImplementation(function () {
				return { analyzeSong: mockAnalyzeSong };
			});

			mockFetchAndStoreLyrics.mockResolvedValueOnce(
				Result.err(new GeniusFetchError("https://genius.com/x", 503)),
			);
			vi.mocked(getAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(new Map()),
			);

			const pipeline = await unwrapPipeline();
			const result = await pipeline.analyzeSongs("account-123", [
				{ songId: "lyrics-down", artist: "A", title: "T", lyrics: "" },
			]);

			expect(mockAnalyzeSong).not.toHaveBeenCalled();
			if (Result.isOk(result)) {
				expect(result.value.skippedConfirmedInputsMissing).toEqual([]);
				expect(result.value.skippedUnconfirmedLyrics).toEqual(["lyrics-down"]);
				expect(result.value.skippedUnconfirmedAudio).toEqual([]);
				expect(result.value.skippedUnconfirmedBoth).toEqual([]);
				expect(result.value.failed).toBe(1);
			}
		});

		it("Genius fetch error + audio query errored => unconfirmed_both (non-terminal)", async () => {
			const { GeniusFetchError } = await import(
				"@/lib/shared/errors/external/genius"
			);
			const { DatabaseError } = await import("@/lib/shared/errors/database");
			const mockAnalyzeSong = vi.fn();
			const { SongAnalysisService } = await import("../song-analysis");
			(
				SongAnalysisService as unknown as ReturnType<typeof vi.fn>
			).mockImplementation(function () {
				return { analyzeSong: mockAnalyzeSong };
			});

			mockFetchAndStoreLyrics.mockResolvedValueOnce(
				Result.err(new GeniusFetchError("https://genius.com/x", 503)),
			);
			vi.mocked(getAudioFeaturesBatch).mockResolvedValueOnce(
				Result.err(
					new DatabaseError({ code: "TIMEOUT", message: "audio failed" }),
				),
			);

			const pipeline = await unwrapPipeline();
			const result = await pipeline.analyzeSongs("account-123", [
				{ songId: "everything-down", artist: "A", title: "T", lyrics: "" },
			]);

			expect(mockAnalyzeSong).not.toHaveBeenCalled();
			if (Result.isOk(result)) {
				expect(result.value.skippedConfirmedInputsMissing).toEqual([]);
				expect(result.value.skippedUnconfirmedLyrics).toEqual([]);
				expect(result.value.skippedUnconfirmedAudio).toEqual([]);
				expect(result.value.skippedUnconfirmedBoth).toEqual([
					"everything-down",
				]);
				expect(result.value.failed).toBe(1);
			}
		});
	});
});

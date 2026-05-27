import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioFeature } from "@/lib/domains/enrichment/audio-features/queries";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	GeniusFetchError,
	GeniusNotFoundError,
} from "@/lib/shared/errors/external/genius";
import {
	LlmProviderError,
	LlmRateLimitError,
} from "@/lib/shared/errors/external/llm";

vi.mock("@/lib/domains/enrichment/audio-features/queries", () => ({
	getBatch: vi.fn(),
}));

vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: vi.fn(),
}));

vi.mock("@/lib/domains/enrichment/lyrics/service", () => ({
	LyricsService: vi.fn(),
}));

vi.mock("@/lib/integrations/llm/service", () => ({
	LlmService: vi.fn(),
}));

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

const { getBatch: mockGetAudioFeaturesBatch } = await import(
	"@/lib/domains/enrichment/audio-features/queries"
);
const { getByIds: mockGetSongsByIds } = await import(
	"@/lib/domains/library/songs/queries"
);

import {
	analyzeSongBatch,
	type BatchSong,
	createSongBatchAnalyzerDeps,
	type SongBatchAnalyzerDeps,
} from "../song-batch-analysis";

function makeSong(id: string, lyrics = ""): BatchSong {
	return { songId: id, artist: "Artist", title: `Song ${id}`, lyrics };
}

function makeAudioFeature(songId: string): AudioFeature {
	return {
		id: `af-${songId}`,
		song_id: songId,
		acousticness: 0.5,
		danceability: 0.5,
		energy: 0.5,
		instrumentalness: 0.1,
		key: 5,
		liveness: 0.1,
		loudness: -8,
		mode: 1,
		speechiness: 0.05,
		tempo: 120,
		time_signature: 4,
		valence: 0.5,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	};
}

describe("analyzeSongBatch", () => {
	let mockAnalyzeSong: ReturnType<typeof vi.fn>;
	let mockFetchAndStoreLyrics: ReturnType<typeof vi.fn>;
	let deps: SongBatchAnalyzerDeps;

	beforeEach(() => {
		vi.mocked(mockGetSongsByIds).mockResolvedValue(Result.ok([]));

		mockAnalyzeSong = vi.fn().mockResolvedValue(
			Result.ok({
				songId: "any",
				analysis: { headline: "test" },
				cached: false,
			}),
		);
		mockFetchAndStoreLyrics = vi.fn();

		deps = {
			lyricsService: { fetchAndStoreLyrics: mockFetchAndStoreLyrics } as never,
			songAnalysisService: { analyzeSong: mockAnalyzeSong } as never,
			concurrency: 5,
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns empty outcome for empty input", async () => {
		const outcome = await analyzeSongBatch([], deps);

		expect(outcome).toEqual({
			analyzedSongIds: [],
			failedSongIds: [],
			failureClassifications: new Map(),
			skippedConfirmedInputsMissing: [],
			skippedUnconfirmedLyrics: [],
			skippedUnconfirmedAudio: [],
			skippedUnconfirmedBoth: [],
		});
		expect(mockAnalyzeSong).not.toHaveBeenCalled();
	});

	describe("skipped confirmed-input bucket", () => {
		it("skips songs when both lyrics and audio are confirmed missing", async () => {
			vi.mocked(mockGetAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(new Map<string, AudioFeature>()),
			);
			mockFetchAndStoreLyrics.mockResolvedValueOnce(
				Result.err(new GeniusNotFoundError("Artist", "Song s1")),
			);

			const songs = [makeSong("s1")];
			const outcome = await analyzeSongBatch(songs, deps);

			expect(outcome.skippedConfirmedInputsMissing).toEqual(["s1"]);
			expect(outcome.analyzedSongIds).toEqual([]);
			expect(outcome.failedSongIds).toEqual([]);
			expect(mockAnalyzeSong).not.toHaveBeenCalled();
		});
	});

	describe("skipped unconfirmed lyrics bucket", () => {
		it("classifies as unconfirmed lyrics when fetch error and audio confirmed missing", async () => {
			vi.mocked(mockGetAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(new Map<string, AudioFeature>()),
			);
			mockFetchAndStoreLyrics.mockResolvedValueOnce(
				Result.err(new GeniusFetchError("Timeout", 500)),
			);

			const songs = [makeSong("s1")];
			const outcome = await analyzeSongBatch(songs, deps);

			expect(outcome.skippedUnconfirmedLyrics).toEqual(["s1"]);
			expect(outcome.skippedConfirmedInputsMissing).toEqual([]);
			expect(mockAnalyzeSong).not.toHaveBeenCalled();
		});
	});

	describe("skipped unconfirmed audio bucket", () => {
		it("classifies as unconfirmed audio when audio query fails and lyrics confirmed missing", async () => {
			vi.mocked(mockGetAudioFeaturesBatch).mockResolvedValueOnce(
				Result.err({ message: "DB unavailable" } as never),
			);
			mockFetchAndStoreLyrics.mockResolvedValueOnce(
				Result.err(new GeniusNotFoundError("Artist", "Song s1")),
			);

			const songs = [makeSong("s1")];
			const outcome = await analyzeSongBatch(songs, deps);

			expect(outcome.skippedUnconfirmedAudio).toEqual(["s1"]);
			expect(mockAnalyzeSong).not.toHaveBeenCalled();
		});
	});

	describe("skipped unconfirmed both bucket", () => {
		it("classifies as unconfirmed both when both providers fail", async () => {
			vi.mocked(mockGetAudioFeaturesBatch).mockResolvedValueOnce(
				Result.err({ message: "DB unavailable" } as never),
			);
			mockFetchAndStoreLyrics.mockResolvedValueOnce(
				Result.err(new GeniusFetchError("Timeout", 500)),
			);

			const songs = [makeSong("s1")];
			const outcome = await analyzeSongBatch(songs, deps);

			expect(outcome.skippedUnconfirmedBoth).toEqual(["s1"]);
			expect(mockAnalyzeSong).not.toHaveBeenCalled();
		});
	});

	describe("analyzed bucket", () => {
		it("analyzes songs that have lyrics available", async () => {
			vi.mocked(mockGetAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(new Map<string, AudioFeature>()),
			);

			const songs = [makeSong("s1", "Some lyrics content here")];
			const outcome = await analyzeSongBatch(songs, deps);

			expect(outcome.analyzedSongIds).toEqual(["s1"]);
			expect(outcome.failedSongIds).toEqual([]);
			expect(mockAnalyzeSong).toHaveBeenCalledOnce();
		});

		it("analyzes songs that have audio features available", async () => {
			const audioMap = new Map<string, AudioFeature>();
			audioMap.set("s1", makeAudioFeature("s1"));
			vi.mocked(mockGetAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(audioMap),
			);

			const songs = [makeSong("s1")];
			deps.lyricsService = null;

			const outcome = await analyzeSongBatch(songs, deps);

			expect(outcome.analyzedSongIds).toEqual(["s1"]);
			expect(mockAnalyzeSong).toHaveBeenCalledOnce();
		});
	});

	describe("failed bucket", () => {
		it("records failed songs when analysis returns error", async () => {
			vi.mocked(mockGetAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(new Map<string, AudioFeature>()),
			);
			mockAnalyzeSong.mockResolvedValueOnce(
				Result.err(new Error("LLM timeout")),
			);

			const songs = [makeSong("s1", "Has lyrics")];
			const outcome = await analyzeSongBatch(songs, deps);

			expect(outcome.failedSongIds).toEqual(["s1"]);
			expect(outcome.analyzedSongIds).toEqual([]);
		});
	});

	describe("mixed batch classification", () => {
		it("correctly partitions a batch into all buckets", async () => {
			const audioMap = new Map<string, AudioFeature>();
			audioMap.set("s2", makeAudioFeature("s2"));
			vi.mocked(mockGetAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(audioMap),
			);

			// Songs needing lyrics fetch: s1, s2, s3 (s4 has lyrics)
			// s1: confirmed missing, s2: found (but also has audio), s3: found
			mockFetchAndStoreLyrics
				.mockResolvedValueOnce(
					Result.err(new GeniusNotFoundError("Artist", "Song s1")),
				)
				.mockResolvedValueOnce(Result.ok("Found lyrics for s2"))
				.mockResolvedValueOnce(Result.ok("Found lyrics for s3"));

			mockAnalyzeSong
				.mockResolvedValueOnce(
					Result.ok({ songId: "s2", analysis: {}, cached: false }),
				)
				.mockResolvedValueOnce(
					Result.ok({ songId: "s3", analysis: {}, cached: false }),
				)
				.mockResolvedValueOnce(
					Result.ok({ songId: "s4", analysis: {}, cached: false }),
				);

			const songs = [
				makeSong("s1"),
				makeSong("s2"),
				makeSong("s3"),
				makeSong("s4", "Has lyrics already"),
			];

			const outcome = await analyzeSongBatch(songs, deps);

			expect(outcome.skippedConfirmedInputsMissing).toEqual(["s1"]);
			expect(outcome.analyzedSongIds).toContain("s2");
			expect(outcome.analyzedSongIds).toContain("s3");
			expect(outcome.analyzedSongIds).toContain("s4");
			expect(outcome.failedSongIds).toEqual([]);
		});
	});

	describe("failure classification (failureClassifications)", () => {
		it("classifies LlmRateLimitError as retryable and preserves retry metadata", async () => {
			vi.mocked(mockGetAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(new Map<string, AudioFeature>()),
			);
			mockAnalyzeSong.mockResolvedValueOnce(
				Result.err(
					new LlmRateLimitError({ provider: "google", retryAfterMs: 5000 }),
				),
			);

			const songs = [makeSong("s1", "Has lyrics")];
			const outcome = await analyzeSongBatch(songs, deps);

			expect(outcome.failedSongIds).toEqual(["s1"]);
			expect(outcome.failureClassifications.get("s1")).toMatchObject({
				isRetryable: true,
				cause: "llm_rate_limit",
				retryAfterMs: 5000,
				provider: "google",
			});
		});

		// The error -> classification mapping is tested in
		// failure-classification.test.ts; here we only prove the wiring: a failed
		// song's error reaches the classifier and is stored under its songId.
		it.each([
			{
				name: "LlmProviderError 5xx",
				error: () =>
					new LlmProviderError({
						provider: "google",
						model: "gemini-2.5-flash",
						statusCode: 503,
						message: "Service unavailable",
					}),
				cause: "llm_provider",
			},
			{
				name: "LlmProviderError 4xx",
				error: () =>
					new LlmProviderError({
						provider: "google",
						model: "gemini-2.5-flash",
						statusCode: 400,
						message: "Bad request",
					}),
				cause: "llm_provider",
			},
			{
				name: "generic Error",
				error: () => new Error("Unknown failure"),
				cause: "unknown",
			},
			{
				name: "DatabaseError",
				error: () =>
					new DatabaseError({ code: "08006", message: "connection lost" }),
				cause: "database",
			},
		])("routes a failed song's $name through the classifier", async ({
			error,
			cause,
		}) => {
			vi.mocked(mockGetAudioFeaturesBatch).mockResolvedValueOnce(
				Result.ok(new Map<string, AudioFeature>()),
			);
			mockAnalyzeSong.mockResolvedValueOnce(Result.err(error()));

			const outcome = await analyzeSongBatch(
				[makeSong("s1", "Has lyrics")],
				deps,
			);

			expect(outcome.failedSongIds).toEqual(["s1"]);
			expect(outcome.failureClassifications.get("s1")).toMatchObject({ cause });
		});
	});

	describe("does not touch job lifecycle", () => {
		it("the module source does not import job lifecycle modules", async () => {
			const fs = await import("node:fs");
			const path = await import("node:path");
			const source = fs.readFileSync(
				path.resolve(__dirname, "../song-batch-analysis.ts"),
				"utf-8",
			);
			expect(source).not.toContain("@/lib/platform/jobs/lifecycle");
			expect(source).not.toContain("@/lib/data/jobs");
			expect(source).not.toContain("createJob");
			expect(source).not.toContain("startJob");
			expect(source).not.toContain("finalizeJob");
		});
	});

	describe("createSongBatchAnalyzerDeps", () => {
		it("rejects invalid concurrency before creating provider services", () => {
			const result = createSongBatchAnalyzerDeps({ concurrency: 0 });

			expect(Result.isError(result)).toBe(true);
		});
	});
});

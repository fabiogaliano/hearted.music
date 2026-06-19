/**
 * §7.1 — Blocked-skip failure rows carry the underlying provider error detail
 * (error class, HTTP status, URL) instead of a canned message.
 *
 * Tests the full thread: prefetch error → blockedSkipErrors map → StageFailure
 * fields (message, provider, statusCode, causeTag).
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSongAnalysisGet = vi.fn();
const mockAnalyzeSongBatch = vi.fn();
const mockCreateSongBatchAnalyzerDeps = vi.fn();

vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	get: (ids: string[]) => mockSongAnalysisGet(ids),
}));

vi.mock(
	"@/lib/domains/enrichment/content-analysis/song-batch-analysis",
	() => ({
		analyzeSongBatch: (...args: unknown[]) => mockAnalyzeSongBatch(...args),
		createSongBatchAnalyzerDeps: (...args: unknown[]) =>
			mockCreateSongBatchAnalyzerDeps(...args),
	}),
);

import type { AnalysisFailureClassification } from "@/lib/domains/enrichment/content-analysis/failure-classification";
import {
	GeniusFetchError,
	GeniusParseError,
} from "@/lib/shared/errors/external/genius";
import type { PipelineBatch } from "../batch";
import type { StageOutcome } from "../stage-outcomes";
import { runSongAnalysis } from "../stages/song-analysis";
import type { EnrichmentContext } from "../types";

function makeBatch(songIds: string[]): PipelineBatch {
	const now = new Date().toISOString();
	return {
		songIds,
		songs: songIds.map((id) => ({
			id,
			spotify_id: `sp-${id}`,
			name: id,
			artists: ["test"],
			artist_ids: [],
			genres: [],
			album_id: null,
			album_name: null,
			image_url: null,
			preview_url: null,
			duration_ms: null,
			popularity: null,
			isrc: null,
			release_year: null,
			release_year_checked_at: null,
			vocal_gender: null,
			language: null,
			language_confidence: null,
			language_secondary: null,
			language_checked_at: null,
			created_at: now,
			updated_at: now,
		})),
		spotifyIdBySongId: new Map(songIds.map((id) => [id, `sp-${id}`])),
	};
}

function makeCtx(): EnrichmentContext {
	return {
		accountId: "account-1",
		embeddingService: {} as EnrichmentContext["embeddingService"],
		profilingService: {} as EnrichmentContext["profilingService"],
		jobId: "job-1",
	};
}

function emptyBatchOutcome() {
	return {
		analyzedSongIds: [],
		failedSongIds: [],
		failureClassifications: new Map<string, AnalysisFailureClassification>(),
		skippedConfirmedInputsMissing: [],
		skippedUnconfirmedLyrics: [],
		skippedUnconfirmedAudio: [],
		skippedUnconfirmedBoth: [],
		retryCandidateSongIds: [],
		blockedSkipErrors: new Map<string, unknown>(),
	};
}

function expectAttempted(
	outcome: StageOutcome,
): Extract<StageOutcome, { kind: "attempted" }> {
	if (outcome.kind !== "attempted") {
		throw new Error(`Expected attempted outcome, got ${outcome.kind}`);
	}
	return outcome;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockSongAnalysisGet.mockResolvedValue(Result.ok(new Map()));
	mockCreateSongBatchAnalyzerDeps.mockReturnValue(
		Result.ok({ lyricsService: null, songAnalysisService: {}, concurrency: 5 }),
	);
	mockAnalyzeSongBatch.mockResolvedValue(emptyBatchOutcome());
});

describe("runSongAnalysis: blocked-skip error detail (§7.1)", () => {
	it("GeniusParseError in blockedSkipErrors threads class, URL, and causeTag into the StageFailure", async () => {
		const parseError = new GeniusParseError(
			"https://genius.com/Brock-berrigan-crossing-paths-lyrics",
			"no lyrics container",
		);
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			skippedUnconfirmedLyrics: ["crossing-paths"],
			blockedSkipErrors: new Map([["crossing-paths", parseError]]),
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map()));

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["crossing-paths"])),
		);

		expect(outcome.failures).toHaveLength(1);
		const failure = outcome.failures[0];
		expect(failure.songId).toBe("crossing-paths");
		expect(failure.failureCode).toBe("analysis_blocked_lyrics_unavailable");

		// Must contain the error class and URL — NOT the canned message.
		expect(failure.message).toContain("GeniusParseError");
		expect(failure.message).toContain(
			"https://genius.com/Brock-berrigan-crossing-paths-lyrics",
		);
		expect(failure.message).not.toBe(
			"Analysis skipped: audio confirmed missing, lyrics provider unavailable",
		);

		expect(failure.provider).toBe("genius");
		expect(failure.causeTag).toBe("parse_error");
		expect(failure.statusCode).toBeUndefined();
	});

	it("GeniusFetchError threads HTTP status code and URL into the StageFailure", async () => {
		const fetchError = new GeniusFetchError(
			"https://genius.com/search?q=test",
			503,
		);
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			skippedUnconfirmedBoth: ["song-both"],
			blockedSkipErrors: new Map([["song-both", fetchError]]),
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map()));

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["song-both"])),
		);

		expect(outcome.failures).toHaveLength(1);
		const failure = outcome.failures[0];
		expect(failure.failureCode).toBe("analysis_blocked_both_unavailable");

		expect(failure.message).toContain("GeniusFetchError");
		expect(failure.message).toContain("https://genius.com/search?q=test");
		expect(failure.provider).toBe("genius");
		expect(failure.statusCode).toBe(503);
		expect(failure.causeTag).toBe("fetch_error");
	});

	it("falls back to canned message when no error is in blockedSkipErrors", async () => {
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			skippedUnconfirmedLyrics: ["song-no-error"],
			// blockedSkipErrors is empty — no entry for this song.
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map()));

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["song-no-error"])),
		);

		expect(outcome.failures).toHaveLength(1);
		const failure = outcome.failures[0];
		// Falls back gracefully when no error is recorded.
		expect(failure.message).toBe(
			"Analysis skipped: audio confirmed missing, lyrics provider unavailable",
		);
		expect(failure.provider).toBeUndefined();
		expect(failure.statusCode).toBeUndefined();
		expect(failure.causeTag).toBeUndefined();
	});

	it("audio-unavailable bucket uses canned message (no per-song error source)", async () => {
		// Audio unavailability is a pipeline-level condition — no per-song error
		// is propagated, so the canned fallback is always correct for this bucket.
		mockAnalyzeSongBatch.mockResolvedValue({
			...emptyBatchOutcome(),
			skippedUnconfirmedAudio: ["song-audio-down"],
		});
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map()));

		const outcome = expectAttempted(
			await runSongAnalysis(makeCtx(), makeBatch(["song-audio-down"])),
		);

		expect(outcome.failures).toHaveLength(1);
		const failure = outcome.failures[0];
		expect(failure.failureCode).toBe("analysis_blocked_audio_unavailable");
		expect(failure.message).toBe(
			"Analysis skipped: lyrics confirmed missing, audio provider unavailable",
		);
	});
});

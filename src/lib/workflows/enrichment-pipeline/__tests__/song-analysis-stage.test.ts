/**
 * Stage-level tests for runSongAnalysis. Verifies that songs skipped by the
 * analysis-input gate are recorded as terminal job_failure rows with the
 * structured `analysis_inputs_missing` code, and that LLM-failed songs still
 * use the existing `permanent` failure code without overlap.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRecordJobFailure = vi.fn().mockResolvedValue(Result.ok(undefined));
const mockSongAnalysisGet = vi.fn();
const mockAnalyzeSongs = vi.fn();
const mockCreateAnalysisPipeline = vi.fn();

vi.mock("@/lib/data/job-failures", () => ({
	recordJobFailure: (params: Record<string, unknown>) =>
		mockRecordJobFailure(params),
}));

vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	get: (ids: string[]) => mockSongAnalysisGet(ids),
}));

vi.mock("@/lib/domains/enrichment/content-analysis/pipeline", () => ({
	createAnalysisPipeline: () => mockCreateAnalysisPipeline(),
}));

import type { PipelineBatch } from "../batch";
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
			created_at: now,
			updated_at: now,
		})),
		spotifyIdBySongId: new Map(songIds.map((id) => [id, `sp-${id}`])),
	};
}

function makeCtx(jobId = "job-1"): EnrichmentContext {
	return {
		accountId: "account-1",
		embeddingService: {} as EnrichmentContext["embeddingService"],
		profilingService: {} as EnrichmentContext["profilingService"],
		jobId,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockSongAnalysisGet.mockResolvedValue(Result.ok(new Map()));
	mockCreateAnalysisPipeline.mockReturnValue(
		Result.ok({ analyzeSongs: mockAnalyzeSongs }),
	);
});

interface RecordedFailure {
	itemId: string;
	failureCode: string;
	isTerminal: boolean;
}

function recordedFailures(): RecordedFailure[] {
	return mockRecordJobFailure.mock.calls.map(
		(call) => call[0] as RecordedFailure,
	);
}

function emptySkipBuckets() {
	return {
		skippedConfirmedInputsMissing: [],
		skippedUnconfirmedLyrics: [],
		skippedUnconfirmedAudio: [],
		skippedUnconfirmedBoth: [],
	};
}

describe("runSongAnalysis: analysis-input gate (tri-state)", () => {
	it("records terminal analysis_inputs_missing for confirmed-missing songs", async () => {
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 0,
				failed: 1,
				total: 1,
				...emptySkipBuckets(),
				skippedConfirmedInputsMissing: ["skip-me"],
			}),
		);

		const result = await runSongAnalysis(makeCtx(), makeBatch(["skip-me"]));

		const failures = recordedFailures();
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			itemId: "skip-me",
			failureCode: "analysis_inputs_missing",
			isTerminal: true,
		});
		expect(result).toEqual({ total: 1, succeeded: 0, failed: 1 });
	});

	it("records non-terminal analysis_inputs_unconfirmed_lyrics", async () => {
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 0,
				failed: 1,
				total: 1,
				...emptySkipBuckets(),
				skippedUnconfirmedLyrics: ["lyrics-down"],
			}),
		);

		await runSongAnalysis(makeCtx(), makeBatch(["lyrics-down"]));

		const failures = recordedFailures();
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			itemId: "lyrics-down",
			failureCode: "analysis_inputs_unconfirmed_lyrics",
			isTerminal: false,
		});
	});

	it("records non-terminal analysis_inputs_unconfirmed_audio", async () => {
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 0,
				failed: 1,
				total: 1,
				...emptySkipBuckets(),
				skippedUnconfirmedAudio: ["audio-down"],
			}),
		);

		await runSongAnalysis(makeCtx(), makeBatch(["audio-down"]));

		const failures = recordedFailures();
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			itemId: "audio-down",
			failureCode: "analysis_inputs_unconfirmed_audio",
			isTerminal: false,
		});
	});

	it("records non-terminal analysis_inputs_unconfirmed_both", async () => {
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 0,
				failed: 1,
				total: 1,
				...emptySkipBuckets(),
				skippedUnconfirmedBoth: ["everything-down"],
			}),
		);

		await runSongAnalysis(makeCtx(), makeBatch(["everything-down"]));

		const failures = recordedFailures();
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			itemId: "everything-down",
			failureCode: "analysis_inputs_unconfirmed_both",
			isTerminal: false,
		});
	});

	it("does not double-record skipped songs as 'permanent'", async () => {
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 0,
				failed: 4,
				total: 4,
				...emptySkipBuckets(),
				skippedConfirmedInputsMissing: ["confirmed"],
				skippedUnconfirmedLyrics: ["unconfirmed-lyrics"],
				skippedUnconfirmedAudio: ["unconfirmed-audio"],
				skippedUnconfirmedBoth: ["unconfirmed-both"],
			}),
		);
		mockSongAnalysisGet.mockResolvedValue(Result.ok(new Map()));

		await runSongAnalysis(
			makeCtx(),
			makeBatch([
				"confirmed",
				"unconfirmed-lyrics",
				"unconfirmed-audio",
				"unconfirmed-both",
			]),
		);

		const failures = recordedFailures();
		expect(failures).toHaveLength(4);
		const byItem = new Map(failures.map((f) => [f.itemId, f]));
		expect(byItem.get("confirmed")).toMatchObject({
			failureCode: "analysis_inputs_missing",
			isTerminal: true,
		});
		expect(byItem.get("unconfirmed-lyrics")).toMatchObject({
			failureCode: "analysis_inputs_unconfirmed_lyrics",
			isTerminal: false,
		});
		expect(byItem.get("unconfirmed-audio")).toMatchObject({
			failureCode: "analysis_inputs_unconfirmed_audio",
			isTerminal: false,
		});
		expect(byItem.get("unconfirmed-both")).toMatchObject({
			failureCode: "analysis_inputs_unconfirmed_both",
			isTerminal: false,
		});
	});

	it("records permanent for LLM-failed songs alongside skip categories in one batch", async () => {
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 0,
				failed: 3,
				total: 3,
				...emptySkipBuckets(),
				skippedConfirmedInputsMissing: ["confirmed"],
				skippedUnconfirmedLyrics: ["unconfirmed-lyrics"],
			}),
		);
		mockSongAnalysisGet.mockResolvedValue(Result.ok(new Map()));

		await runSongAnalysis(
			makeCtx(),
			makeBatch(["confirmed", "unconfirmed-lyrics", "llm-fail"]),
		);

		const failures = recordedFailures();
		expect(failures).toHaveLength(3);
		const byItem = new Map(failures.map((f) => [f.itemId, f]));
		expect(byItem.get("confirmed")).toMatchObject({
			failureCode: "analysis_inputs_missing",
			isTerminal: true,
		});
		expect(byItem.get("unconfirmed-lyrics")).toMatchObject({
			failureCode: "analysis_inputs_unconfirmed_lyrics",
			isTerminal: false,
		});
		expect(byItem.get("llm-fail")).toMatchObject({
			failureCode: "permanent",
			isTerminal: true,
		});
	});

	it("records nothing when all songs analyze successfully", async () => {
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 1,
				failed: 0,
				total: 1,
				...emptySkipBuckets(),
			}),
		);

		await runSongAnalysis(makeCtx(), makeBatch(["ok"]));

		expect(mockRecordJobFailure).not.toHaveBeenCalled();
	});
});

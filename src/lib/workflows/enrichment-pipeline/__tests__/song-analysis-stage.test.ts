/**
 * Stage-level tests for runSongAnalysis. Verifies that songs skipped by the
 * analysis-input gate are recorded with the correct lifecycle code and
 * terminal flag, that LLM-failed songs use 'permanent' (terminal), and that
 * compensation only fires for terminal `analysis_inputs_missing`.
 *
 * The stage now goes through `recordStageFailure`, which composes the
 * failure-policy module + DB layer; we mock that wrapper so unit tests stay
 * pure.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRecordStageFailure = vi.fn().mockResolvedValue(Result.ok(undefined));
const mockResolveStageFailures = vi.fn().mockResolvedValue(Result.ok(0));
const mockSongAnalysisGet = vi.fn();
const mockAnalyzeSongs = vi.fn();
const mockCreateAnalysisPipeline = vi.fn();
const mockGrantCompensation = vi
	.fn()
	.mockResolvedValue(Result.ok({ kind: "granted", credits: 1, newBalance: 1 }));
const mockCreateAdminClient = vi.fn().mockReturnValue({});

vi.mock("../record-failure", () => ({
	recordStageFailure: (params: Record<string, unknown>) =>
		mockRecordStageFailure(params),
}));

vi.mock("@/lib/data/job-failures", () => ({
	resolveStageFailures: (params: Record<string, unknown>) =>
		mockResolveStageFailures(params),
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => mockCreateAdminClient(),
}));

vi.mock("@/lib/domains/billing/compensation", () => ({
	grantAnalysisFailureReplacementCredit: (
		client: unknown,
		params: { accountId: string; songId: string; failureCode: string },
	) => mockGrantCompensation(client, params),
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

function makeCtx(): EnrichmentContext {
	return {
		accountId: "account-1",
		embeddingService: {} as EnrichmentContext["embeddingService"],
		profilingService: {} as EnrichmentContext["profilingService"],
		jobId: "job-1",
	};
}

function makeCtxWithoutJobId(): EnrichmentContext {
	return {
		accountId: "account-1",
		embeddingService: {} as EnrichmentContext["embeddingService"],
		profilingService: {} as EnrichmentContext["profilingService"],
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockSongAnalysisGet.mockResolvedValue(Result.ok(new Map()));
	mockCreateAnalysisPipeline.mockReturnValue(
		Result.ok({ analyzeSongs: mockAnalyzeSongs }),
	);
	mockGrantCompensation.mockResolvedValue(
		Result.ok({ kind: "granted", credits: 1, newBalance: 1 }),
	);
	mockCreateAdminClient.mockReturnValue({});
	mockResolveStageFailures.mockResolvedValue(Result.ok(0));
});

interface RecordedFailure {
	itemId?: string;
	songId?: string;
	failureCode: string;
}

function recordedFailures(): RecordedFailure[] {
	return mockRecordStageFailure.mock.calls.map(
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
			songId: "skip-me",
			failureCode: "analysis_inputs_missing",
		});
		expect(result).toEqual({ total: 1, succeeded: 0, failed: 1 });
	});

	it("records analysis_blocked_lyrics_unavailable for skippedUnconfirmedLyrics", async () => {
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
			songId: "lyrics-down",
			failureCode: "analysis_blocked_lyrics_unavailable",
		});
	});

	it("records analysis_blocked_audio_unavailable for skippedUnconfirmedAudio", async () => {
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
			songId: "audio-down",
			failureCode: "analysis_blocked_audio_unavailable",
		});
	});

	it("records analysis_blocked_both_unavailable for skippedUnconfirmedBoth", async () => {
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
			songId: "everything-down",
			failureCode: "analysis_blocked_both_unavailable",
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
		const byItem = new Map(failures.map((f) => [f.songId, f]));
		expect(byItem.get("confirmed")).toMatchObject({
			failureCode: "analysis_inputs_missing",
		});
		expect(byItem.get("unconfirmed-lyrics")).toMatchObject({
			failureCode: "analysis_blocked_lyrics_unavailable",
		});
		expect(byItem.get("unconfirmed-audio")).toMatchObject({
			failureCode: "analysis_blocked_audio_unavailable",
		});
		expect(byItem.get("unconfirmed-both")).toMatchObject({
			failureCode: "analysis_blocked_both_unavailable",
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
		const byItem = new Map(failures.map((f) => [f.songId, f]));
		expect(byItem.get("confirmed")).toMatchObject({
			failureCode: "analysis_inputs_missing",
		});
		expect(byItem.get("unconfirmed-lyrics")).toMatchObject({
			failureCode: "analysis_blocked_lyrics_unavailable",
		});
		expect(byItem.get("llm-fail")).toMatchObject({
			failureCode: "permanent",
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

		expect(mockRecordStageFailure).not.toHaveBeenCalled();
	});
});

describe("runSongAnalysis: stage-success resolution", () => {
	it("resolves prior non-terminal failures for songs that produced an analysis", async () => {
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 1,
				failed: 0,
				total: 1,
				...emptySkipBuckets(),
			}),
		);
		// Pre-run check: not yet analyzed (so song is "ready").
		// Post-run check: analysis is present (this run produced it).
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(
				Result.ok(new Map([["recovered-song", { id: "a-1" }]])),
			);

		await runSongAnalysis(makeCtx(), makeBatch(["recovered-song"]));

		expect(mockResolveStageFailures).toHaveBeenCalledTimes(1);
		expect(mockResolveStageFailures).toHaveBeenCalledWith({
			accountId: "account-1",
			itemId: "recovered-song",
			stage: "song_analysis",
		});
	});

	it("does not call resolve when no song produced an analysis", async () => {
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 0,
				failed: 1,
				total: 1,
				...emptySkipBuckets(),
				skippedUnconfirmedBoth: ["still-down"],
			}),
		);
		mockSongAnalysisGet.mockResolvedValue(Result.ok(new Map()));

		await runSongAnalysis(makeCtx(), makeBatch(["still-down"]));

		expect(mockResolveStageFailures).not.toHaveBeenCalled();
	});
});

describe("runSongAnalysis: replacement-credit compensation", () => {
	it("calls compensation helper for each confirmed-missing song", async () => {
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 0,
				failed: 2,
				total: 2,
				...emptySkipBuckets(),
				skippedConfirmedInputsMissing: ["pack-song-a", "pack-song-b"],
			}),
		);

		await runSongAnalysis(makeCtx(), makeBatch(["pack-song-a", "pack-song-b"]));

		expect(mockGrantCompensation).toHaveBeenCalledTimes(2);
		const calls = mockGrantCompensation.mock.calls.map(
			(c) => c[1] as { accountId: string; songId: string; failureCode: string },
		);
		const byId = new Map(calls.map((c) => [c.songId, c]));
		expect(byId.get("pack-song-a")).toEqual({
			accountId: "account-1",
			songId: "pack-song-a",
			failureCode: "analysis_inputs_missing",
		});
		expect(byId.get("pack-song-b")).toEqual({
			accountId: "account-1",
			songId: "pack-song-b",
			failureCode: "analysis_inputs_missing",
		});
	});

	it("does not call compensation for unconfirmed skip categories", async () => {
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 0,
				failed: 3,
				total: 3,
				...emptySkipBuckets(),
				skippedUnconfirmedLyrics: ["lyrics-only"],
				skippedUnconfirmedAudio: ["audio-only"],
				skippedUnconfirmedBoth: ["both-down"],
			}),
		);

		await runSongAnalysis(
			makeCtx(),
			makeBatch(["lyrics-only", "audio-only", "both-down"]),
		);

		expect(mockGrantCompensation).not.toHaveBeenCalled();
		expect(mockRecordStageFailure).toHaveBeenCalledTimes(3);
	});

	it("does not call compensation for LLM permanent failures", async () => {
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 0,
				failed: 1,
				total: 1,
				...emptySkipBuckets(),
			}),
		);
		mockSongAnalysisGet.mockResolvedValue(Result.ok(new Map()));

		await runSongAnalysis(makeCtx(), makeBatch(["llm-fail"]));

		expect(mockGrantCompensation).not.toHaveBeenCalled();
		const failures = recordedFailures();
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			songId: "llm-fail",
			failureCode: "permanent",
		});
	});

	it("compensation failures do not break the stage", async () => {
		const { DatabaseError } = await import("@/lib/shared/errors/database");
		mockGrantCompensation.mockResolvedValue(
			Result.err(
				new DatabaseError({ code: "FAIL", message: "compensation rpc down" }),
			),
		);
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 0,
				failed: 1,
				total: 1,
				...emptySkipBuckets(),
				skippedConfirmedInputsMissing: ["pack-song"],
			}),
		);

		const result = await runSongAnalysis(makeCtx(), makeBatch(["pack-song"]));

		expect(result).toEqual({ total: 1, succeeded: 0, failed: 1 });
		expect(mockRecordStageFailure).toHaveBeenCalledTimes(1);
		expect(mockGrantCompensation).toHaveBeenCalledTimes(1);
	});

	it("does not call compensation when no jobId is set on the context", async () => {
		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: undefined,
				succeeded: 0,
				failed: 1,
				total: 1,
				...emptySkipBuckets(),
				skippedConfirmedInputsMissing: ["pack-song"],
			}),
		);

		const ctx = makeCtxWithoutJobId();

		await runSongAnalysis(ctx, makeBatch(["pack-song"]));

		expect(mockRecordStageFailure).not.toHaveBeenCalled();
		expect(mockGrantCompensation).not.toHaveBeenCalled();
	});
});

describe("runSongAnalysis: post-run lookup failure", () => {
	it("records analysis_postrun_lookup_unavailable for uncertain songs (not permanent)", async () => {
		const { DatabaseError } = await import("@/lib/shared/errors/database");

		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 0,
				failed: 1,
				total: 1,
				...emptySkipBuckets(),
			}),
		);

		// Pre-run check: empty (song is "ready").
		// Post-run check: errors out — we don't know what succeeded.
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(
				Result.err(
					new DatabaseError({
						code: "FAIL",
						message: "post-run lookup down",
					}),
				),
			);

		await runSongAnalysis(makeCtx(), makeBatch(["uncertain"]));

		// One recordStageFailure call: the new postrun-lookup-unavailable code.
		// No resolves — state unknown. No `permanent` rows.
		expect(mockResolveStageFailures).not.toHaveBeenCalled();
		const failures = mockRecordStageFailure.mock.calls.map(
			(call) => call[0] as { songId: string; failureCode: string },
		);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			songId: "uncertain",
			failureCode: "analysis_postrun_lookup_unavailable",
		});
		expect(failures.some((f) => f.failureCode === "permanent")).toBe(false);
	});

	it("does not record postrun-unavailable when no jobId is set", async () => {
		const { DatabaseError } = await import("@/lib/shared/errors/database");

		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: undefined,
				succeeded: 0,
				failed: 1,
				total: 1,
				...emptySkipBuckets(),
			}),
		);
		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(
				Result.err(
					new DatabaseError({
						code: "FAIL",
						message: "post-run lookup down",
					}),
				),
			);

		await runSongAnalysis(makeCtxWithoutJobId(), makeBatch(["uncertain"]));

		expect(mockRecordStageFailure).not.toHaveBeenCalled();
		expect(mockResolveStageFailures).not.toHaveBeenCalled();
	});

	it("still records skip-bucket failures and excludes them from uncertain set", async () => {
		const { DatabaseError } = await import("@/lib/shared/errors/database");

		mockAnalyzeSongs.mockResolvedValue(
			Result.ok({
				jobId: "job-1",
				succeeded: 0,
				failed: 3,
				total: 3,
				...emptySkipBuckets(),
				skippedUnconfirmedBoth: ["both-down"],
				skippedConfirmedInputsMissing: ["confirmed-missing"],
			}),
		);

		mockSongAnalysisGet
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(
				Result.err(
					new DatabaseError({
						code: "FAIL",
						message: "post-run lookup down",
					}),
				),
			);

		await runSongAnalysis(
			makeCtx(),
			makeBatch(["both-down", "confirmed-missing", "uncertain-llm"]),
		);

		const failures = mockRecordStageFailure.mock.calls.map(
			(call) => call[0] as { songId: string; failureCode: string },
		);
		expect(failures).toHaveLength(3);
		const byId = new Map(failures.map((f) => [f.songId, f]));
		// Skip-bucket rows still written with their dedicated codes.
		expect(byId.get("both-down")?.failureCode).toBe(
			"analysis_blocked_both_unavailable",
		);
		expect(byId.get("confirmed-missing")?.failureCode).toBe(
			"analysis_inputs_missing",
		);
		// Only the non-skipped ready candidate gets the postrun-unavailable row.
		expect(byId.get("uncertain-llm")?.failureCode).toBe(
			"analysis_postrun_lookup_unavailable",
		);
		// Compensation still fires for the terminal confirmed-missing case.
		expect(mockGrantCompensation).toHaveBeenCalledTimes(1);
		// No resolves — post-run lookup failed so success state is unknown.
		expect(mockResolveStageFailures).not.toHaveBeenCalled();
	});
});

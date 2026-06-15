import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import type { EnrichmentWorkPlan } from "../types";

// --- Mocks ---

const mockSelectEnrichmentWorkPlan = vi.fn<() => Promise<EnrichmentWorkPlan>>();
const mockLoadBatchSongs = vi.fn<() => Promise<PipelineBatch>>();
const mockHasMoreSongsNeedingEnrichmentWork = vi.fn<() => Promise<boolean>>();
const mockGetEntitledDataEnrichedSongIds = vi.fn<() => Promise<string[]>>();

vi.mock("../batch", () => ({
	selectEnrichmentWorkPlan: (...args: unknown[]) =>
		mockSelectEnrichmentWorkPlan(...(args as [])),
	loadBatchSongs: (...args: unknown[]) => mockLoadBatchSongs(...(args as [])),
	hasMoreSongsNeedingEnrichmentWork: (...args: unknown[]) =>
		mockHasMoreSongsNeedingEnrichmentWork(...(args as [])),
	getEntitledDataEnrichedSongIds: (...args: unknown[]) =>
		mockGetEntitledDataEnrichedSongIds(...(args as [])),
}));

const mockRunAudioFeatures = vi.fn();
const mockRunGenreTagging = vi.fn();
const mockRunSongAnalysis = vi.fn();
const mockRunSongEmbedding = vi.fn();
const mockRunContentActivation = vi.fn();
const {
	mockCreateAdminSupabaseClient,
	mockGrantAnalysisFailureReplacementCredit,
} = vi.hoisted(() => ({
	mockCreateAdminSupabaseClient: vi.fn(() => ({})),
	mockGrantAnalysisFailureReplacementCredit: vi.fn(),
}));

vi.mock("../stages/audio-features", () => ({
	runAudioFeatures: (...args: unknown[]) => mockRunAudioFeatures(...args),
}));
vi.mock("../stages/genre-tagging", () => ({
	runGenreTagging: (...args: unknown[]) => mockRunGenreTagging(...args),
}));
vi.mock("../stages/song-analysis", () => ({
	runSongAnalysis: (...args: unknown[]) => mockRunSongAnalysis(...args),
}));
vi.mock("../stages/content-activation", () => ({
	runContentActivation: (...args: unknown[]) =>
		mockRunContentActivation(...args),
}));
vi.mock("../stages/song-embedding", () => ({
	runSongEmbedding: (...args: unknown[]) => mockRunSongEmbedding(...args),
}));

const { mockGetEmbeddings, mockGetAnalysis } = vi.hoisted(() => ({
	mockGetEmbeddings: vi.fn(),
	mockGetAnalysis: vi.fn(),
}));

vi.mock("@/lib/domains/enrichment/embeddings/service", () => ({
	EmbeddingService: {
		create: () => Result.ok({ getEmbeddings: mockGetEmbeddings }),
	},
}));

vi.mock("@/lib/platform/jobs/repository", () => ({
	updateJobProgress: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => mockCreateAdminSupabaseClient(),
}));

vi.mock("@/lib/domains/billing/compensation", () => ({
	grantAnalysisFailureReplacementCredit: (...args: unknown[]) =>
		mockGrantAnalysisFailureReplacementCredit(...args),
}));

vi.mock("@/lib/platform/jobs/item-failures", () => ({
	resolveJobStageFailures: vi.fn().mockResolvedValue(Result.ok(0)),
}));

vi.mock("../record-failure", () => ({
	recordStageFailure: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

vi.mock("@/lib/domains/enrichment/audio-features/queries", () => ({
	getBatch: vi.fn().mockResolvedValue(Result.ok(new Map())),
}));

// The analysis gate reads audio availability to defer songs whose backfill is
// in flight. Default to an empty result (set in beforeEach) so the gate is a
// no-op for these tests.
const mockGetAudioFeatureAvailability = vi.fn();
vi.mock("@/lib/domains/enrichment/audio-feature-backfill/jobs", () => ({
	getAudioFeatureAvailability: (...args: unknown[]) =>
		mockGetAudioFeatureAvailability(...args),
}));

vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	get: mockGetAnalysis,
}));

vi.mock("@/lib/domains/library/liked-songs/status-queries", () => ({
	markPipelineProcessed: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

const { mockGetByIds } = vi.hoisted(() => ({ mockGetByIds: vi.fn() }));
vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: mockGetByIds,
}));

vi.mock("@/lib/integrations/llm/service", () => ({
	createLlmService: vi.fn().mockReturnValue(undefined),
}));

vi.mock("@/lib/domains/taste/playlist-profiling/service", () => ({
	createPlaylistProfilingService: vi.fn().mockReturnValue({}),
}));

import { executeWorkerChunk } from "../orchestrator";
import { recordStageFailure } from "../record-failure";
import type { StageOutcome } from "../stage-outcomes";

// --- Helpers ---

function analysisOutcomeSuccess(songIds: string[]): StageOutcome {
	return {
		kind: "attempted",
		stage: "song_analysis",
		candidateSongIds: songIds,
		attemptedSongIds: songIds,
		succeededSongIds: songIds,
		failures: [],
	};
}

function audioOutcomeSuccess(songIds: string[]): StageOutcome {
	return {
		kind: "attempted",
		stage: "audio_features",
		candidateSongIds: songIds,
		attemptedSongIds: songIds,
		succeededSongIds: songIds,
		failures: [],
	};
}

function genreOutcomeSuccess(songIds: string[]): StageOutcome {
	return {
		kind: "attempted",
		stage: "genre_tagging",
		candidateSongIds: songIds,
		attemptedSongIds: songIds,
		succeededSongIds: songIds,
		failures: [],
	};
}

function embeddingOutcomeSuccess(songIds: string[]): StageOutcome {
	return {
		kind: "attempted",
		stage: "song_embedding",
		candidateSongIds: songIds,
		attemptedSongIds: songIds,
		succeededSongIds: songIds,
		failures: [],
	};
}

function activationOutcomeSuccess(songIds: string[]): StageOutcome {
	return {
		kind: "attempted",
		stage: "content_activation",
		candidateSongIds: songIds,
		attemptedSongIds: songIds,
		succeededSongIds: songIds,
		failures: [],
	};
}

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
			genres: ["rock"],
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

function makeWorkPlan(
	overrides: Partial<EnrichmentWorkPlan>,
): EnrichmentWorkPlan {
	const allSongIds = overrides.allSongIds ?? [];
	return {
		allSongIds,
		flags: allSongIds.map((songId) => ({
			songId,
			needsAudioFeatures: (overrides.needAudioFeatures ?? []).includes(songId),
			needsGenreTagging: (overrides.needGenreTagging ?? []).includes(songId),
			needsAnalysis: (overrides.needAnalysis ?? []).includes(songId),
			needsEmbedding: (overrides.needEmbedding ?? []).includes(songId),
			needsContentActivation: (overrides.needContentActivation ?? []).includes(
				songId,
			),
		})),
		needAudioFeatures: overrides.needAudioFeatures ?? [],
		needGenreTagging: overrides.needGenreTagging ?? [],
		needAnalysis: overrides.needAnalysis ?? [],
		needEmbedding: overrides.needEmbedding ?? [],
		needContentActivation: overrides.needContentActivation ?? [],
	};
}

// --- Tests ---

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(recordStageFailure).mockResolvedValue(Result.ok(undefined));
	mockGrantAnalysisFailureReplacementCredit.mockResolvedValue(
		Result.ok({ kind: "granted", credits: 1, newBalance: 1 }),
	);
	mockRunAudioFeatures.mockImplementation(
		(_ctx: unknown, batch: PipelineBatch) =>
			Promise.resolve(audioOutcomeSuccess(batch.songIds)),
	);
	mockRunGenreTagging.mockImplementation(
		(_ctx: unknown, batch: PipelineBatch) =>
			Promise.resolve(genreOutcomeSuccess(batch.songIds)),
	);
	mockRunSongAnalysis.mockImplementation(
		(_ctx: unknown, batch: PipelineBatch) =>
			Promise.resolve(analysisOutcomeSuccess(batch.songIds)),
	);
	mockRunSongEmbedding.mockImplementation(
		(_ctx: unknown, batch: PipelineBatch) =>
			Promise.resolve(embeddingOutcomeSuccess(batch.songIds)),
	);
	mockRunContentActivation.mockImplementation(
		(_ctx: unknown, songIds: string[]) =>
			Promise.resolve(activationOutcomeSuccess(songIds)),
	);
	mockHasMoreSongsNeedingEnrichmentWork.mockResolvedValue(false);
	mockGetEmbeddings.mockResolvedValue(Result.ok(new Map()));
	mockGetAnalysis.mockResolvedValue(Result.ok(new Map()));
	mockGetByIds.mockResolvedValue(Result.ok([]));
	mockGetEntitledDataEnrichedSongIds.mockResolvedValue([]);
	mockGetAudioFeatureAvailability.mockResolvedValue(Result.ok([]));
});

describe("executeWorkerChunk sub-batching", () => {
	it("runs only Phase A stages for a song needing only audio_features + genre_tagging", async () => {
		const workPlan = makeWorkPlan({
			allSongIds: ["song-1"],
			needAudioFeatures: ["song-1"],
			needGenreTagging: ["song-1"],
			needAnalysis: [],
			needEmbedding: [],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch(["song-1"]));

		await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(mockRunAudioFeatures).toHaveBeenCalledOnce();
		expect(mockRunGenreTagging).toHaveBeenCalledOnce();
		expect(mockRunSongAnalysis).not.toHaveBeenCalled();
		expect(mockRunSongEmbedding).not.toHaveBeenCalled();
	});

	it("runs all four stages for an entitled song needing all stages", async () => {
		const workPlan = makeWorkPlan({
			allSongIds: ["song-2"],
			needAudioFeatures: ["song-2"],
			needGenreTagging: ["song-2"],
			needAnalysis: ["song-2"],
			needEmbedding: ["song-2"],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch(["song-2"]));

		await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(mockRunAudioFeatures).toHaveBeenCalledOnce();
		expect(mockRunGenreTagging).toHaveBeenCalledOnce();
		expect(mockRunSongAnalysis).toHaveBeenCalledOnce();
		expect(mockRunSongEmbedding).toHaveBeenCalledOnce();
	});

	it("runs no stage runners for an empty batch", async () => {
		const workPlan = makeWorkPlan({ allSongIds: [] });
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch([]));

		const result = await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(mockRunAudioFeatures).not.toHaveBeenCalled();
		expect(mockRunGenreTagging).not.toHaveBeenCalled();
		expect(mockRunSongAnalysis).not.toHaveBeenCalled();
		expect(mockRunSongEmbedding).not.toHaveBeenCalled();
		expect(result.readyCount).toBe(0);
		expect(mockHasMoreSongsNeedingEnrichmentWork).toHaveBeenCalledOnce();
	});

	it("dispatches correct sub-batches for a mixed batch", async () => {
		const workPlan = makeWorkPlan({
			allSongIds: ["a", "b"],
			needAudioFeatures: ["a", "b"],
			needGenreTagging: ["a"],
			needAnalysis: ["b"],
			needEmbedding: ["b"],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch(["a", "b"]));

		await executeWorkerChunk("account-1", "job-1", 10, 0);

		// audio_features called with both songs
		const audioBatch = mockRunAudioFeatures.mock.calls[0][1] as PipelineBatch;
		expect(audioBatch.songIds).toEqual(["a", "b"]);

		// genre_tagging called with only "a"
		const genreBatch = mockRunGenreTagging.mock.calls[0][1] as PipelineBatch;
		expect(genreBatch.songIds).toEqual(["a"]);

		// analysis called with only "b"
		const analysisBatch = mockRunSongAnalysis.mock.calls[0][1] as PipelineBatch;
		expect(analysisBatch.songIds).toEqual(["b"]);

		// embedding called with only "b"
		const embeddingBatch = mockRunSongEmbedding.mock
			.calls[0][1] as PipelineBatch;
		expect(embeddingBatch.songIds).toEqual(["b"]);
	});

	it("fails the parent attempt when audio feature accounting cannot persist", async () => {
		const workPlan = makeWorkPlan({
			allSongIds: ["song-1"],
			needAudioFeatures: ["song-1"],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch(["song-1"]));
		mockRunAudioFeatures.mockResolvedValue({
			kind: "attempted",
			stage: "audio_features",
			candidateSongIds: ["song-1"],
			attemptedSongIds: ["song-1"],
			succeededSongIds: [],
			failures: [
				{
					songId: "song-1",
					failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
					message: "provider timeout",
				},
			],
		});
		vi.mocked(recordStageFailure).mockResolvedValue(
			Result.err(
				new DatabaseError({
					code: "PGRST",
					message: "failed to insert failure row",
				}),
			),
		);
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			executeWorkerChunk("account-1", "job-1", 10, 0),
		).rejects.toThrow("Failed to record failure rows for stage audio_features");

		expect(mockRunContentActivation).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("records durable per-candidate failures when an audio readiness check throws", async () => {
		const workPlan = makeWorkPlan({
			allSongIds: ["s1", "s2"],
			needAudioFeatures: ["s1", "s2"],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch(["s1", "s2"]));
		mockRunAudioFeatures.mockRejectedValue(
			new Error("Failed to check existing audio features: connection refused"),
		);
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(result.failedCount).toBe(2);
		expect(recordStageFailure).toHaveBeenCalledTimes(2);
		const failureRows = vi
			.mocked(recordStageFailure)
			.mock.calls.map(([params]) => params);
		expect(failureRows.map((row) => row.songId).sort()).toEqual(["s1", "s2"]);
		for (const row of failureRows) {
			expect(row).toMatchObject({
				stage: "audio_features",
				failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
				errorMessage:
					"Failed to check existing audio features: connection refused",
			});
		}

		consoleSpy.mockRestore();
	});

	it("triggers analysis-input compensation through finalized song-analysis accounting", async () => {
		const workPlan = makeWorkPlan({
			allSongIds: ["pack-song"],
			needAnalysis: ["pack-song"],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch(["pack-song"]));
		mockRunSongAnalysis.mockResolvedValue({
			kind: "attempted",
			stage: "song_analysis",
			candidateSongIds: ["pack-song"],
			attemptedSongIds: ["pack-song"],
			succeededSongIds: [],
			failures: [
				{
					songId: "pack-song",
					failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
					message: "missing inputs",
				},
			],
		});

		await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(mockGrantAnalysisFailureReplacementCredit).toHaveBeenCalledOnce();
		expect(mockGrantAnalysisFailureReplacementCredit).toHaveBeenCalledWith(
			expect.anything(),
			{
				accountId: "account-1",
				songId: "pack-song",
				failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
			},
		);
	});

	it("compensates only analysis_inputs_missing failures, not other failure codes", async () => {
		const workPlan = makeWorkPlan({
			allSongIds: ["miss", "perm"],
			needAnalysis: ["miss", "perm"],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch(["miss", "perm"]));
		mockRunSongAnalysis.mockResolvedValue({
			kind: "attempted",
			stage: "song_analysis",
			candidateSongIds: ["miss", "perm"],
			attemptedSongIds: ["miss", "perm"],
			succeededSongIds: [],
			failures: [
				{
					songId: "miss",
					failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
					message: "missing inputs",
				},
				{
					songId: "perm",
					failureCode: FAILURE_CODES.PERMANENT,
					message: "llm failed",
				},
			],
		});

		await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(mockGrantAnalysisFailureReplacementCredit).toHaveBeenCalledOnce();
		expect(mockGrantAnalysisFailureReplacementCredit).toHaveBeenCalledWith(
			expect.anything(),
			{
				accountId: "account-1",
				songId: "miss",
				failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
			},
		);
	});

	it("does not compensate when failure-row recording fails", async () => {
		const workPlan = makeWorkPlan({
			allSongIds: ["pack-song"],
			needAnalysis: ["pack-song"],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch(["pack-song"]));
		mockRunSongAnalysis.mockResolvedValue({
			kind: "attempted",
			stage: "song_analysis",
			candidateSongIds: ["pack-song"],
			attemptedSongIds: ["pack-song"],
			succeededSongIds: [],
			failures: [
				{
					songId: "pack-song",
					failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
					message: "missing inputs",
				},
			],
		});
		vi.mocked(recordStageFailure).mockResolvedValue(
			Result.err(new DatabaseError({ code: "FAIL", message: "insert failed" })),
		);
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			executeWorkerChunk("account-1", "job-1", 10, 0),
		).rejects.toThrow();

		expect(mockGrantAnalysisFailureReplacementCredit).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("aborts the chunk when replacement-credit compensation fails", async () => {
		const workPlan = makeWorkPlan({
			allSongIds: ["pack-song"],
			needAnalysis: ["pack-song"],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch(["pack-song"]));
		mockRunSongAnalysis.mockResolvedValue({
			kind: "attempted",
			stage: "song_analysis",
			candidateSongIds: ["pack-song"],
			attemptedSongIds: ["pack-song"],
			succeededSongIds: [],
			failures: [
				{
					songId: "pack-song",
					failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
					message: "missing inputs",
				},
			],
		});
		mockGrantAnalysisFailureReplacementCredit.mockResolvedValue(
			Result.err(new DatabaseError({ code: "FAIL", message: "rpc down" })),
		);

		await expect(
			executeWorkerChunk("account-1", "job-1", 10, 0),
		).rejects.toThrow();
	});

	it("expands a thrown song_analysis stage to one failure row per candidate", async () => {
		const workPlan = makeWorkPlan({
			allSongIds: ["s1", "s2"],
			needAnalysis: ["s1", "s2"],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch(["s1", "s2"]));
		mockRunSongAnalysis.mockRejectedValue(new Error("llm provider down"));
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(result.failedCount).toBe(2);
		expect(recordStageFailure).toHaveBeenCalledTimes(2);
		const failureRows = vi
			.mocked(recordStageFailure)
			.mock.calls.map(([params]) => params);
		expect(failureRows.map((row) => row.songId).sort()).toEqual(["s1", "s2"]);
		for (const row of failureRows) {
			expect(row).toMatchObject({
				stage: "song_analysis",
				failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
				errorMessage: "llm provider down",
			});
		}

		consoleSpy.mockRestore();
	});
});

describe("content activation", () => {
	it("calls runContentActivation with needContentActivation song IDs", async () => {
		const workPlan = makeWorkPlan({
			allSongIds: ["song-1", "song-2"],
			needAudioFeatures: ["song-1"],
			needContentActivation: ["song-2"],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch(["song-1", "song-2"]));

		await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(mockRunContentActivation).toHaveBeenCalledOnce();
		const [ctx, songIds] = mockRunContentActivation.mock.calls[0] as [
			unknown,
			string[],
		];
		expect(songIds).toEqual(["song-2"]);
		expect(ctx).toMatchObject({ accountId: "account-1" });
	});

	it("does not call runContentActivation when no songs need activation", async () => {
		const workPlan = makeWorkPlan({
			allSongIds: ["song-1"],
			needAudioFeatures: ["song-1"],
			needContentActivation: [],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch(["song-1"]));

		await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(mockRunContentActivation).not.toHaveBeenCalled();
	});

	it("songs that only completed Phase A do not get content activation", async () => {
		const workPlan = makeWorkPlan({
			allSongIds: ["phase-a-only"],
			needAudioFeatures: ["phase-a-only"],
			needGenreTagging: ["phase-a-only"],
			needAnalysis: [],
			needEmbedding: [],
			needContentActivation: [],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch(["phase-a-only"]));

		await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(mockRunContentActivation).not.toHaveBeenCalled();
	});
});

describe("newCandidatesAvailable readiness", () => {
	// Readiness + entitlement is owned by the canonical selector
	// (getEntitledDataEnrichedSongIds → select_entitled_data_enriched_liked_song_ids).
	// These tests assert how the orchestrator consumes its before/after snapshots;
	// the entitlement gate itself is exercised against the real DB in
	// entitled-candidates-newly-ready.integration.test.ts.

	function readinessWorkPlan(songId: string) {
		const workPlan = makeWorkPlan({
			allSongIds: [songId],
			needAnalysis: [songId],
			needEmbedding: [songId],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(makeBatch([songId]));
	}

	it("flips true when an entitled batch song becomes newly ready", async () => {
		const songId = "newly-ready-song";
		readinessWorkPlan(songId);

		// Not ready before; ready after the stages run.
		mockGetEntitledDataEnrichedSongIds
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([songId]);

		const result = await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(result.newCandidatesAvailable).toBe(true);
	});

	it("stays false when a newly-ready song is not entitled (excluded by the selector)", async () => {
		const songId = "locked-song";
		readinessWorkPlan(songId);

		// The selector applies the entitlement gate: a locked/revoked song is
		// absent from its result even after gaining genres+analysis+embedding.
		mockGetEntitledDataEnrichedSongIds
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		const result = await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(result.newCandidatesAvailable).toBe(false);
	});

	it("ignores entitled songs that became ready outside this batch", async () => {
		const batchSongId = "batch-song";
		readinessWorkPlan(batchSongId);

		// Selector is account-wide; a song outside this batch must not count as a
		// candidate produced by this chunk.
		mockGetEntitledDataEnrichedSongIds
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(["some-other-song"]);

		const result = await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(result.newCandidatesAvailable).toBe(false);
	});

	it("stays false when no batch song changed readiness", async () => {
		const songId = "already-ready-song";
		readinessWorkPlan(songId);

		// Ready both before and after → nothing newly available.
		mockGetEntitledDataEnrichedSongIds
			.mockResolvedValueOnce([songId])
			.mockResolvedValueOnce([songId]);

		const result = await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(result.newCandidatesAvailable).toBe(false);
	});
});

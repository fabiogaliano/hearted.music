import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineBatch } from "../batch";
import type { EnrichmentWorkPlan } from "../types";

// --- Mocks ---

const mockSelectEnrichmentWorkPlan = vi.fn<() => Promise<EnrichmentWorkPlan>>();
const mockLoadBatchSongs = vi.fn<() => Promise<PipelineBatch>>();
const mockHasMoreSongsNeedingEnrichmentWork = vi.fn<() => Promise<boolean>>();

vi.mock("../batch", () => ({
	selectEnrichmentWorkPlan: (...args: unknown[]) =>
		mockSelectEnrichmentWorkPlan(...(args as [])),
	loadBatchSongs: (...args: unknown[]) => mockLoadBatchSongs(...(args as [])),
	hasMoreSongsNeedingEnrichmentWork: (...args: unknown[]) =>
		mockHasMoreSongsNeedingEnrichmentWork(...(args as [])),
}));

const mockRunAudioFeatures = vi.fn();
const mockRunGenreTagging = vi.fn();
const mockRunSongAnalysis = vi.fn();
const mockRunSongEmbedding = vi.fn();
const mockRunContentActivation = vi.fn();

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
	EmbeddingService: vi.fn().mockImplementation(() => ({
		getEmbeddings: mockGetEmbeddings,
	})),
}));

vi.mock("@/lib/data/jobs", () => ({
	updateJobProgress: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

vi.mock("@/lib/domains/enrichment/audio-features/queries", () => ({
	getBatch: vi.fn().mockResolvedValue(Result.ok(new Map())),
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

// --- Helpers ---

const stageSuccess = { total: 1, succeeded: 1, failed: 0 };

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
	mockRunAudioFeatures.mockResolvedValue(stageSuccess);
	mockRunGenreTagging.mockResolvedValue(stageSuccess);
	mockRunSongAnalysis.mockResolvedValue(stageSuccess);
	mockRunSongEmbedding.mockResolvedValue(stageSuccess);
	mockRunContentActivation.mockResolvedValue(undefined);
	mockHasMoreSongsNeedingEnrichmentWork.mockResolvedValue(false);
	mockGetEmbeddings.mockResolvedValue(Result.ok(new Map()));
	mockGetAnalysis.mockResolvedValue(Result.ok(new Map()));
	mockGetByIds.mockResolvedValue(Result.ok([]));
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

		expect(mockRunContentActivation).toHaveBeenCalledOnce();
		const [, songIds] = mockRunContentActivation.mock.calls[0] as [
			unknown,
			string[],
		];
		expect(songIds).toEqual([]);
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

		const [, songIds] = mockRunContentActivation.mock.calls[0] as [
			unknown,
			string[],
		];
		expect(songIds).toEqual([]);
	});
});

describe("newCandidatesAvailable readiness (audio optional)", () => {
	it("flips true when a song reaches genres+analysis+embedding even without audio_features", async () => {
		const songId = "audioless-song";
		const batch = makeBatch([songId]);

		const workPlan = makeWorkPlan({
			allSongIds: [songId],
			needAnalysis: [songId],
			needEmbedding: [songId],
		});
		mockSelectEnrichmentWorkPlan.mockResolvedValue(workPlan);
		mockLoadBatchSongs.mockResolvedValue(batch);

		// Re-query of the batch songs after stages run — readiness rule still
		// requires song.genres, which makeBatch already populates.
		mockGetByIds.mockResolvedValue(Result.ok(batch.songs));

		// Before stages: no analysis or embedding rows yet.
		// After stages: analysis + embedding present (audio is intentionally absent).
		mockGetAnalysis
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map([[songId, { id: "a-1" }]])));
		mockGetEmbeddings
			.mockResolvedValueOnce(Result.ok(new Map()))
			.mockResolvedValueOnce(Result.ok(new Map([[songId, { id: "e-1" }]])));

		const result = await executeWorkerChunk("account-1", "job-1", 10, 0);

		expect(result.newCandidatesAvailable).toBe(true);
	});
});

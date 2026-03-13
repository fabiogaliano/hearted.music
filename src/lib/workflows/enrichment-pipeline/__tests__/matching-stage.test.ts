import { describe, it, expect, vi, beforeEach } from "vitest";
import { Result } from "better-result";
import type { PipelineBatch } from "../batch";
import type { EnrichmentContext } from "../types";

vi.mock("@/lib/domains/library/liked-songs/queries", () => ({
	getPending: vi.fn(),
}));

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getMatchContextByHash: vi.fn(),
	createMatchContext: vi.fn(),
	insertMatchResults: vi.fn(),
}));

vi.mock("@/lib/domains/enrichment/audio-features/queries", () => ({
	getBatch: vi.fn(),
}));

vi.mock("@/lib/domains/enrichment/embeddings/hashing", () => ({
	hashCandidateSet: vi.fn(),
	hashPlaylistSet: vi.fn(),
	hashMatchingConfig: vi.fn(),
	hashMatchContext: vi.fn(),
}));

vi.mock("@/lib/domains/enrichment/embeddings/versioning", () => ({
	MATCHING_ALGO_VERSION: "test_matching_v1",
	getModelBundleHash: vi.fn(),
}));

vi.mock("@/lib/domains/taste/song-matching/config", () => ({
	DEFAULT_MATCHING_CONFIG: {
		weights: { audio: 0.3, genre: 0.3, embedding: 0.4 },
		audioWeights: {
			energy: 0.2,
			valence: 0.2,
			danceability: 0.2,
			acousticness: 0.1,
			instrumentalness: 0.1,
			speechiness: 0.05,
			liveness: 0.05,
			tempo: 0.05,
			loudness: 0.05,
		},
		minScoreThreshold: 0.1,
	},
}));

vi.mock("@/lib/domains/taste/song-matching/service", () => ({
	createMatchingService: vi.fn(),
}));

vi.mock("../job-runner", () => ({
	runTrackedStageJob: vi.fn(),
}));

import * as likedSongData from "@/lib/domains/library/liked-songs/queries";
import * as matchingData from "@/lib/domains/taste/song-matching/queries";
import * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import {
	hashCandidateSet,
	hashPlaylistSet,
	hashMatchingConfig,
	hashMatchContext,
} from "@/lib/domains/enrichment/embeddings/hashing";
import { getModelBundleHash } from "@/lib/domains/enrichment/embeddings/versioning";
import { runTrackedStageJob } from "../job-runner";
import { runMatchingStage } from "../stages/matching";

const mockPending = likedSongData.getPending as ReturnType<typeof vi.fn>;
const mockGetContextByHash = matchingData.getMatchContextByHash as ReturnType<
	typeof vi.fn
>;
const mockGetBatch = audioFeatureData.getBatch as ReturnType<typeof vi.fn>;
const mockHashCandidateSet = hashCandidateSet as ReturnType<typeof vi.fn>;
const mockHashPlaylistSet = hashPlaylistSet as ReturnType<typeof vi.fn>;
const mockHashMatchingConfig = hashMatchingConfig as ReturnType<typeof vi.fn>;
const mockHashMatchContext = hashMatchContext as ReturnType<typeof vi.fn>;
const mockGetModelBundleHash = getModelBundleHash as ReturnType<typeof vi.fn>;
const mockRunTrackedStageJob = runTrackedStageJob as ReturnType<typeof vi.fn>;

function makeFakeCtx(): EnrichmentContext {
	return {
		accountId: "acct-1",
		embeddingService: {
			getEmbeddings: vi.fn().mockResolvedValue(Result.ok(new Map())),
		} as any,
		profilingService: {
			getProfile: vi.fn().mockResolvedValue(
				Result.ok({
					playlistId: "pl1",
					embedding: [0.1, 0.2],
					audioCentroid: { energy: 0.6 },
					genreDistribution: { pop: 0.5 },
				}),
			),
		} as any,
	};
}

const fakeBatch: PipelineBatch = {
	songIds: ["s1", "s2"],
	songs: [
		{
			id: "s1",
			spotify_id: "sp1",
			name: "Song 1",
			artists: ["A1"],
			genres: ["pop"],
		} as any,
		{
			id: "s2",
			spotify_id: "sp2",
			name: "Song 2",
			artists: ["A2"],
			genres: ["rock"],
		} as any,
	],
	spotifyIdBySongId: new Map([
		["s1", "sp1"],
		["s2", "sp2"],
	]),
};

const fakePlaylists = [{ id: "pl1", name: "Chill" } as any];

function setupReadyState() {
	mockPending.mockResolvedValue(
		Result.ok([{ song_id: "s1" }, { song_id: "s2" }]),
	);
	mockGetBatch.mockResolvedValue(
		Result.ok(
			new Map([
				[
					"s1",
					{
						energy: 0.5,
						valence: 0.6,
						danceability: 0.7,
						acousticness: 0.3,
						instrumentalness: 0.1,
						speechiness: 0.05,
						liveness: 0.1,
						tempo: 120,
						loudness: -5,
					},
				],
				[
					"s2",
					{
						energy: 0.8,
						valence: 0.4,
						danceability: 0.5,
						acousticness: 0.2,
						instrumentalness: 0.0,
						speechiness: 0.1,
						liveness: 0.2,
						tempo: 140,
						loudness: -3,
					},
				],
			]),
		),
	);

	mockHashCandidateSet.mockResolvedValue("cs_test123");
	mockHashPlaylistSet.mockResolvedValue("ps_test456");
	mockHashMatchingConfig.mockResolvedValue("mc_test789");
	mockGetModelBundleHash.mockResolvedValue(Result.ok("mb_test000"));
	mockHashMatchContext.mockResolvedValue("ctx_testfinal");
}

describe("runMatchingStage - deterministic identity", () => {
	let fakeCtx: EnrichmentContext;

	beforeEach(() => {
		vi.restoreAllMocks();
		fakeCtx = makeFakeCtx();
		setupReadyState();
	});

	it("skips when identical context already exists (dedupe)", async () => {
		mockGetContextByHash.mockResolvedValue(
			Result.ok({ id: "existing-ctx-id" }),
		);

		const result = await runMatchingStage(fakeCtx, fakeBatch, fakePlaylists);

		expect(result.status).toBe("skipped");
		if (result.status === "skipped") {
			expect(result.reason).toBe("identical matching context already exists");
		}
		expect(mockRunTrackedStageJob).not.toHaveBeenCalled();
	});

	it("proceeds when no matching context exists", async () => {
		mockGetContextByHash.mockResolvedValue(Result.ok(null));
		mockRunTrackedStageJob.mockResolvedValue({
			jobId: "job-1",
			succeeded: 2,
			failed: 0,
		});

		const result = await runMatchingStage(fakeCtx, fakeBatch, fakePlaylists);

		expect(result.status).toBe("completed");
		expect(mockRunTrackedStageJob).toHaveBeenCalled();
	});

	it("uses content-based hashing primitives for identity", async () => {
		mockGetContextByHash.mockResolvedValue(Result.ok(null));
		mockRunTrackedStageJob.mockResolvedValue({
			jobId: "job-1",
			succeeded: 2,
			failed: 0,
		});

		await runMatchingStage(fakeCtx, fakeBatch, fakePlaylists);

		expect(mockHashCandidateSet).toHaveBeenCalledWith(
			expect.arrayContaining(["s1", "s2"]),
			expect.arrayContaining([expect.stringContaining("Song 1")]),
		);
		expect(mockHashPlaylistSet).toHaveBeenCalled();
		expect(mockHashMatchingConfig).toHaveBeenCalled();
		expect(mockHashMatchContext).toHaveBeenCalledWith(
			expect.objectContaining({
				candidateSetHash: "cs_test123",
				playlistSetHash: "ps_test456",
				configHash: "mc_test789",
			}),
		);
		expect(mockGetContextByHash).toHaveBeenCalledWith(
			"ctx_testfinal",
			"acct-1",
		);
	});

	it("fails when checking for an existing matching context fails", async () => {
		mockGetContextByHash.mockResolvedValue(
			Result.err({ _tag: "DbError", message: "lookup failed" }),
		);

		const result = await runMatchingStage(fakeCtx, fakeBatch, fakePlaylists);

		expect(result).toEqual({
			stage: "matching",
			status: "failed",
			jobId: null,
			error: "Failed to check existing matching context: lookup failed",
		});
		expect(mockRunTrackedStageJob).not.toHaveBeenCalled();
	});

	it("skips with reason when no destination playlists", async () => {
		const result = await runMatchingStage(fakeCtx, fakeBatch, []);

		expect(result.status).toBe("skipped");
		if (result.status === "skipped") {
			expect(result.reason).toBe("no destination playlists selected");
		}
	});

	it("skips with reason when no playlists have profiles", async () => {
		(
			fakeCtx.profilingService.getProfile as ReturnType<typeof vi.fn>
		).mockResolvedValue(Result.ok(null));

		const result = await runMatchingStage(fakeCtx, fakeBatch, fakePlaylists);

		expect(result.status).toBe("skipped");
		if (result.status === "skipped") {
			expect(result.reason).toBe(
				"no destination playlists with usable profiles",
			);
		}
	});

	it("skips when no ready candidate songs", async () => {
		mockPending.mockResolvedValue(Result.ok([]));

		const result = await runMatchingStage(fakeCtx, fakeBatch, fakePlaylists);

		expect(result.status).toBe("skipped");
		if (result.status === "skipped") {
			expect(result.reason).toBe("no candidate songs ready for matching");
		}
	});
});

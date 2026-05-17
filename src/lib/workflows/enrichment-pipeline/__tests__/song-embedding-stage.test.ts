import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import type { EnrichmentContext } from "../types";

const mockGetAnalysis = vi.fn();
const mockGetEmbeddings = vi.fn();
const mockEmbedBatch = vi.fn();

vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	get: (...args: unknown[]) => mockGetAnalysis(...args),
}));

vi.mock("@/lib/data/job-failures", () => ({
	resolveStageFailures: vi.fn().mockResolvedValue(Result.ok(0)),
}));

vi.mock("../record-failure", () => ({
	recordStageFailure: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

import { recordStageFailure } from "../record-failure";
import {
	getReadyForSongEmbedding,
	runSongEmbedding,
} from "../stages/song-embedding";

function makeBatch(ids: string[]): PipelineBatch {
	return {
		songIds: ids,
		songs: ids.map((id) => ({
			id,
			name: `track-${id}`,
			artists: ["artist"],
			artist_ids: [],
			album_id: null,
			album_name: null,
			genres: [],
			created_at: "2026-01-01T00:00:00Z",
			updated_at: "2026-01-01T00:00:00Z",
			duration_ms: null,
			image_url: null,
			spotify_id: `spotify-${id}`,
		})),
		spotifyIdBySongId: new Map(ids.map((id) => [id, `spotify-${id}`])),
	};
}

function makeCtx(): EnrichmentContext {
	return {
		accountId: "account-1",
		embeddingService: {
			getEmbeddings: mockGetEmbeddings,
			embedBatch: mockEmbedBatch,
		} as unknown as EnrichmentContext["embeddingService"],
		profilingService: {} as EnrichmentContext["profilingService"],
		jobId: "job-1",
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(recordStageFailure).mockResolvedValue(Result.ok(undefined));
	mockGetAnalysis.mockResolvedValue(Result.ok(new Map()));
	mockGetEmbeddings.mockResolvedValue(Result.ok(new Map()));
	mockEmbedBatch.mockResolvedValue(Result.ok({ succeeded: [], failed: [] }));
});

describe("getReadyForSongEmbedding", () => {
	it("classifies songs with existing embeddings as done", async () => {
		const embeddingsMap = new Map([["s1", { song_id: "s1" }]]);
		mockGetEmbeddings.mockResolvedValue(Result.ok(embeddingsMap));
		mockGetAnalysis.mockResolvedValue(Result.ok(new Map([["s2", {}]])));

		const result = await getReadyForSongEmbedding(
			["s1", "s2", "s3"],
			makeCtx().embeddingService,
		);

		expect(result.done).toEqual(["s1"]);
		expect(result.ready).toEqual(["s2"]);
		expect(result.notReady).toEqual(["s3"]);
	});

	it("throws when analysis lookup fails", async () => {
		mockGetAnalysis.mockResolvedValue(
			Result.err({ message: "connection refused" }),
		);
		mockGetEmbeddings.mockResolvedValue(Result.ok(new Map()));

		await expect(
			getReadyForSongEmbedding(["s1"], makeCtx().embeddingService),
		).rejects.toThrow("Failed to check existing analyses");
	});

	it("throws when embedding lookup fails", async () => {
		mockGetAnalysis.mockResolvedValue(Result.ok(new Map()));
		mockGetEmbeddings.mockResolvedValue(
			Result.err({ message: "connection refused" }),
		);

		await expect(
			getReadyForSongEmbedding(["s1"], makeCtx().embeddingService),
		).rejects.toThrow("Failed to check existing embeddings");
	});
});

describe("runSongEmbedding → StageOutcome", () => {
	it("returns skipped when all songs already have embeddings", async () => {
		const embeddingsMap = new Map([
			["s1", { song_id: "s1" }],
			["s2", { song_id: "s2" }],
		]);
		mockGetEmbeddings.mockResolvedValue(Result.ok(embeddingsMap));

		const outcome = await runSongEmbedding(makeCtx(), makeBatch(["s1", "s2"]));

		expect(outcome.kind).toBe("skipped");
		expect(outcome.candidateSongIds).toEqual(["s1", "s2"]);
	});

	it("returns attempted with succeededSongIds for successful embeddings", async () => {
		mockGetAnalysis.mockResolvedValue(
			Result.ok(
				new Map([
					["s1", {}],
					["s2", {}],
				]),
			),
		);
		mockEmbedBatch.mockResolvedValue(
			Result.ok({
				succeeded: [
					{ songId: "s1", embedding: {}, cached: false },
					{ songId: "s2", embedding: {}, cached: false },
				],
				failed: [],
			}),
		);

		const outcome = await runSongEmbedding(makeCtx(), makeBatch(["s1", "s2"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.succeededSongIds).toEqual(["s1", "s2"]);
		expect(outcome.failures).toEqual([]);
		expect(outcome.attemptedSongIds).toEqual(["s1", "s2"]);
	});

	it("maps missing-analysis failures to VALIDATION", async () => {
		mockGetAnalysis.mockResolvedValue(Result.ok(new Map([["s1", {}]])));
		mockEmbedBatch.mockResolvedValue(
			Result.ok({
				succeeded: [],
				failed: [{ songId: "s1", error: "Missing analysis for song" }],
			}),
		);

		const outcome = await runSongEmbedding(makeCtx(), makeBatch(["s1"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.failures).toEqual([
			{
				songId: "s1",
				failureCode: FAILURE_CODES.VALIDATION,
				message: "Embedding failed: Missing analysis for song",
			},
		]);
	});

	it("maps other embedding failures to PERMANENT", async () => {
		mockGetAnalysis.mockResolvedValue(Result.ok(new Map([["s1", {}]])));
		mockEmbedBatch.mockResolvedValue(
			Result.ok({
				succeeded: [],
				failed: [{ songId: "s1", error: "Dimension mismatch" }],
			}),
		);

		const outcome = await runSongEmbedding(makeCtx(), makeBatch(["s1"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.failures).toEqual([
			{
				songId: "s1",
				failureCode: FAILURE_CODES.PERMANENT,
				message: "Embedding failed: Dimension mismatch",
			},
		]);
	});

	it("maps batch-wide embedBatch error to per-song PERMANENT failures", async () => {
		mockGetAnalysis.mockResolvedValue(
			Result.ok(
				new Map([
					["s1", {}],
					["s2", {}],
				]),
			),
		);
		mockEmbedBatch.mockResolvedValue(
			Result.err(new Error("ML provider unreachable")),
		);

		const outcome = await runSongEmbedding(makeCtx(), makeBatch(["s1", "s2"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.succeededSongIds).toEqual([]);
		expect(outcome.failures).toHaveLength(2);
		expect(outcome.failures[0]).toEqual({
			songId: "s1",
			failureCode: FAILURE_CODES.PERMANENT,
			message: "Embedding failed: ML provider unreachable",
		});
		expect(outcome.failures[1]).toEqual({
			songId: "s2",
			failureCode: FAILURE_CODES.PERMANENT,
			message: "Embedding failed: ML provider unreachable",
		});
	});

	it("excludes already-embedded songs from attemptedSongIds", async () => {
		const embeddingsMap = new Map([["s1", { song_id: "s1" }]]);
		mockGetEmbeddings.mockResolvedValue(Result.ok(embeddingsMap));
		mockGetAnalysis.mockResolvedValue(Result.ok(new Map([["s2", {}]])));
		mockEmbedBatch.mockResolvedValue(
			Result.ok({
				succeeded: [{ songId: "s2", embedding: {}, cached: false }],
				failed: [],
			}),
		);

		const outcome = await runSongEmbedding(makeCtx(), makeBatch(["s1", "s2"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.candidateSongIds).toEqual(["s1", "s2"]);
		expect(outcome.attemptedSongIds).toEqual(["s2"]);
		expect(outcome.succeededSongIds).toEqual(["s2"]);
	});

	it("thrown stage expands to per-candidate failures via runStageWithAccounting", async () => {
		mockGetAnalysis.mockResolvedValue(Result.ok(new Map([["s1", {}]])));
		mockGetEmbeddings.mockResolvedValue(
			Result.err({ message: "DB connection lost" }),
		);

		await expect(
			runSongEmbedding(makeCtx(), makeBatch(["s1", "s2", "s3"])),
		).rejects.toThrow("Failed to check existing embeddings");

		const { runStageWithAccounting } = await import("../orchestrator");

		vi.mocked(recordStageFailure).mockResolvedValue(Result.ok(undefined));
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await runStageWithAccounting({
			stage: "song_embedding",
			candidateSongIds: ["s1", "s2", "s3"],
			jobId: "job-1",
			accountId: "account-1",
			fallbackCode: FAILURE_CODES.PROVIDER_TRANSIENT,
			run: async () => {
				throw new Error("DB connection lost");
			},
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) throw new Error("unreachable");
		expect(result.value).toEqual({ total: 3, succeeded: 0, failed: 3 });
		expect(recordStageFailure).toHaveBeenCalledTimes(3);
		expect(recordStageFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				songId: "s1",
				stage: "song_embedding",
				failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
				errorMessage: "DB connection lost",
			}),
		);
		consoleSpy.mockRestore();
	});

	it("mixes succeeded and failed songs in the same outcome", async () => {
		mockGetAnalysis.mockResolvedValue(
			Result.ok(
				new Map([
					["s1", {}],
					["s2", {}],
				]),
			),
		);
		mockEmbedBatch.mockResolvedValue(
			Result.ok({
				succeeded: [{ songId: "s1", embedding: {}, cached: false }],
				failed: [{ songId: "s2", error: "Missing analysis" }],
			}),
		);

		const outcome = await runSongEmbedding(makeCtx(), makeBatch(["s1", "s2"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.succeededSongIds).toEqual(["s1"]);
		expect(outcome.failures).toEqual([
			{
				songId: "s2",
				failureCode: FAILURE_CODES.VALIDATION,
				message: "Embedding failed: Missing analysis",
			},
		]);
	});
});

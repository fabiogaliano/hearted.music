import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	GenreBatchResult,
	GenreEnrichmentService,
} from "@/lib/domains/enrichment/genre-tagging/service";
import type { Song } from "@/lib/domains/library/songs/queries";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import type { EnrichmentContext } from "../types";

const mockEnrichBatch = vi.fn();

vi.mock("@/lib/domains/enrichment/genre-tagging/service", () => ({
	createGenreEnrichmentService: (): Pick<
		GenreEnrichmentService,
		"enrichBatch"
	> => ({
		enrichBatch: (...args: unknown[]) => mockEnrichBatch(...args),
	}),
}));

vi.mock("@/lib/platform/jobs/item-failures", () => ({
	resolveJobStageFailures: vi.fn().mockResolvedValue(Result.ok(0)),
}));

vi.mock("../record-failure", () => ({
	recordStageFailure: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

import { recordStageFailure } from "../record-failure";
import { resolveJobStageFailures } from "@/lib/platform/jobs/item-failures";
import { runGenreTagging } from "../stages/genre-tagging";

function makeSong(id: string, genres: string[] = []): Song {
	return {
		id,
		name: `track-${id}`,
		artists: ["artist"],
		artist_ids: [],
		album_id: null,
		album_name: "album",
		genres,
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		duration_ms: null,
		image_url: null,
		spotify_id: `spotify-${id}`,
	};
}

function makeBatch(
	ids: string[],
	opts?: { cachedIds?: string[] },
): PipelineBatch {
	const cachedSet = new Set(opts?.cachedIds ?? []);
	return {
		songIds: ids,
		songs: ids.map((id) =>
			makeSong(id, cachedSet.has(id) ? ["rock", "indie"] : []),
		),
		spotifyIdBySongId: new Map(ids.map((id) => [id, `spotify-${id}`])),
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

function makeBatchResult(overrides: {
	resultIds?: string[];
	notFound?: string[];
	unavailable?: string[];
	errors?: Array<[string, string]>;
}): GenreBatchResult {
	const resultIds = overrides.resultIds ?? [];
	const notFound = new Set(overrides.notFound ?? []);
	const unavailable = new Set(overrides.unavailable ?? []);
	const errors = new Map(overrides.errors ?? []);

	const results = new Map(
		resultIds.map((id) => [
			id,
			{
				songId: id,
				genres: ["rock"],
				sourceLevel: "track" as const,
				fromCache: false,
			},
		]),
	);

	return {
		results,
		notFound,
		unavailable,
		errors,
		stats: {
			total: resultIds.length + notFound.size + unavailable.size + errors.size,
			cached: 0,
			fetched: resultIds.length,
			notFound: notFound.size,
			unavailable: unavailable.size,
			failed: errors.size + notFound.size + unavailable.size,
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockEnrichBatch.mockResolvedValue(Result.ok(makeBatchResult({})));
});

describe("runGenreTagging → StageOutcome", () => {
	it("returns skipped when all songs already have genres", async () => {
		const batch = makeBatch(["s1", "s2"], { cachedIds: ["s1", "s2"] });

		const outcome = await runGenreTagging(makeCtx(), batch);

		expect(outcome.kind).toBe("skipped");
		expect(outcome.candidateSongIds).toEqual(["s1", "s2"]);
	});

	it("returns attempted with succeededSongIds for fetched genres", async () => {
		mockEnrichBatch.mockResolvedValue(
			Result.ok(makeBatchResult({ resultIds: ["s1", "s2"] })),
		);

		const outcome = await runGenreTagging(makeCtx(), makeBatch(["s1", "s2"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.succeededSongIds).toEqual(["s1", "s2"]);
		expect(outcome.failures).toEqual([]);
		expect(outcome.attemptedSongIds).toEqual(["s1", "s2"]);
	});

	it("returns attempted with succeededSongIds for cached genres (from service cache)", async () => {
		const results = new Map([
			[
				"s1",
				{
					songId: "s1",
					genres: ["rock"],
					sourceLevel: "album" as const,
					fromCache: true,
				},
			],
		]);
		mockEnrichBatch.mockResolvedValue(
			Result.ok({
				results,
				notFound: new Set(),
				unavailable: new Set(),
				errors: new Map(),
				stats: {
					total: 1,
					cached: 1,
					fetched: 0,
					notFound: 0,
					unavailable: 0,
					failed: 0,
				},
			}),
		);

		const outcome = await runGenreTagging(makeCtx(), makeBatch(["s1"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.succeededSongIds).toEqual(["s1"]);
		expect(outcome.failures).toEqual([]);
	});

	it("converts provider unavailable to PROVIDER_UNAVAILABLE StageFailure descriptors", async () => {
		mockEnrichBatch.mockResolvedValue(
			Result.ok(makeBatchResult({ unavailable: ["s1", "s2"] })),
		);

		const outcome = await runGenreTagging(makeCtx(), makeBatch(["s1", "s2"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.succeededSongIds).toEqual([]);
		expect(outcome.failures).toEqual([
			{
				songId: "s1",
				failureCode: FAILURE_CODES.PROVIDER_UNAVAILABLE,
				message: "Genre provider not configured",
			},
			{
				songId: "s2",
				failureCode: FAILURE_CODES.PROVIDER_UNAVAILABLE,
				message: "Genre provider not configured",
			},
		]);
	});

	it("converts source not found to SOURCE_NOT_FOUND StageFailure descriptors", async () => {
		mockEnrichBatch.mockResolvedValue(
			Result.ok(makeBatchResult({ notFound: ["s1"] })),
		);

		const outcome = await runGenreTagging(makeCtx(), makeBatch(["s1"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.failures).toEqual([
			{
				songId: "s1",
				failureCode: FAILURE_CODES.SOURCE_NOT_FOUND,
				message: "No genre data found for track",
			},
		]);
	});

	it("converts batch-wide DB failure to per-candidate PROVIDER_TRANSIENT failures", async () => {
		mockEnrichBatch.mockResolvedValue(
			Result.err({ message: "connection refused" }),
		);

		const outcome = await runGenreTagging(
			makeCtx(),
			makeBatch(["s1", "s2", "s3"]),
		);

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.succeededSongIds).toEqual([]);
		expect(outcome.failures).toHaveLength(3);
		expect(outcome.failures[0]).toEqual({
			songId: "s1",
			failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
			message: "Genre tagging batch failed: connection refused",
		});
		expect(outcome.attemptedSongIds).toEqual(["s1", "s2", "s3"]);
	});

	it("mixes succeeded and failed songs in the same outcome", async () => {
		mockEnrichBatch.mockResolvedValue(
			Result.ok(
				makeBatchResult({
					resultIds: ["s1"],
					notFound: ["s2"],
					errors: [["s3", "API rate limited"]],
				}),
			),
		);

		const outcome = await runGenreTagging(
			makeCtx(),
			makeBatch(["s1", "s2", "s3"]),
		);

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.succeededSongIds).toEqual(["s1"]);
		expect(outcome.failures).toEqual([
			{
				songId: "s3",
				failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
				message: "Genre tagging failed: API rate limited",
			},
			{
				songId: "s2",
				failureCode: FAILURE_CODES.SOURCE_NOT_FOUND,
				message: "No genre data found for track",
			},
		]);
	});

	it("excludes already-cached songs from attemptedSongIds", async () => {
		mockEnrichBatch.mockResolvedValue(
			Result.ok(makeBatchResult({ resultIds: ["s2"] })),
		);

		const batch = makeBatch(["s1", "s2"], { cachedIds: ["s1"] });
		const outcome = await runGenreTagging(makeCtx(), batch);

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.candidateSongIds).toEqual(["s1", "s2"]);
		expect(outcome.attemptedSongIds).toEqual(["s2"]);
		expect(outcome.succeededSongIds).toEqual(["s2"]);
	});

	it("does not call resolveJobStageFailures or recordStageFailure directly", async () => {
		mockEnrichBatch.mockResolvedValue(
			Result.ok(makeBatchResult({ resultIds: ["s1"], notFound: ["s2"] })),
		);

		await runGenreTagging(makeCtx(), makeBatch(["s1", "s2"]));

		expect(resolveJobStageFailures).not.toHaveBeenCalled();
		expect(recordStageFailure).not.toHaveBeenCalled();
	});

	it("thrown stage expands to per-candidate failures via runStageWithAccounting", async () => {
		mockEnrichBatch.mockRejectedValue(new Error("Last.fm timeout"));

		await expect(
			runGenreTagging(makeCtx(), makeBatch(["s1", "s2"])),
		).rejects.toThrow("Last.fm timeout");

		const { runStageWithAccounting } = await import("../orchestrator");

		vi.mocked(recordStageFailure).mockResolvedValue(Result.ok(undefined));
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await runStageWithAccounting({
			stage: "genre_tagging",
			candidateSongIds: ["s1", "s2"],
			jobId: "job-1",
			accountId: "account-1",
			run: async () => {
				throw new Error("Last.fm timeout");
			},
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) throw new Error("unreachable");
		expect(result.value).toEqual({ total: 2, succeeded: 0, failed: 2 });
		expect(recordStageFailure).toHaveBeenCalledTimes(2);
		expect(recordStageFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				songId: "s1",
				stage: "genre_tagging",
				failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
				errorMessage: "Last.fm timeout",
			}),
		);
		consoleSpy.mockRestore();
	});
});

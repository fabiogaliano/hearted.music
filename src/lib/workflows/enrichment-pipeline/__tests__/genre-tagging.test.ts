import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Song } from "@/lib/domains/library/songs/queries";
import type {
	GenreBatchResult,
	GenreEnrichmentService,
} from "@/lib/domains/enrichment/genre-tagging/service";
import type { PipelineBatch } from "../batch";
import type { EnrichmentContext } from "../types";

const mockEnrichBatch = vi.fn();
const mockRecordJobFailure = vi.fn();

vi.mock("@/lib/domains/enrichment/genre-tagging/service", () => ({
	createGenreEnrichmentService: (): Pick<
		GenreEnrichmentService,
		"enrichBatch"
	> => ({
		enrichBatch: (...args: unknown[]) => mockEnrichBatch(...args),
	}),
}));

vi.mock("@/lib/data/job-failures", () => ({
	recordJobFailure: (...args: unknown[]) => mockRecordJobFailure(...args),
}));

import { runGenreTagging } from "../stages/genre-tagging";

function makeSong(id: string): Song {
	return {
		id,
		name: `track-${id}`,
		artists: ["artist"],
		artist_ids: [],
		album_id: null,
		album_name: "album",
		genres: [],
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		duration_ms: null,
		image_url: null,
		isrc: null,
		popularity: null,
		preview_url: null,
		spotify_id: `spotify-${id}`,
	};
}

function makeBatch(ids: string[]): PipelineBatch {
	return {
		songIds: ids,
		songs: ids.map(makeSong),
		spotifyIdBySongId: new Map(ids.map((id) => [id, `spotify-${id}`])),
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

function makeBatchResult(
	overrides: Partial<{
		fetched: number;
		cached: number;
		notFound: string[];
		unavailable: string[];
		errors: Array<[string, string]>;
	}> = {},
): GenreBatchResult {
	const fetched = overrides.fetched ?? 0;
	const cached = overrides.cached ?? 0;
	const notFound = new Set(overrides.notFound ?? []);
	const unavailable = new Set(overrides.unavailable ?? []);
	const errors = new Map(overrides.errors ?? []);
	const total =
		fetched + cached + notFound.size + unavailable.size + errors.size;
	return {
		results: new Map(),
		notFound,
		unavailable,
		errors,
		stats: {
			total,
			cached,
			fetched,
			notFound: notFound.size,
			unavailable: unavailable.size,
			failed: errors.size + notFound.size + unavailable.size,
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockRecordJobFailure.mockResolvedValue(Result.ok(undefined));
});

describe("runGenreTagging stage totals", () => {
	it("counts notFound and unavailable as failed even when errors=0", async () => {
		mockEnrichBatch.mockResolvedValue(
			Result.ok(
				makeBatchResult({
					fetched: 1,
					notFound: ["s2", "s3"],
					unavailable: ["s4"],
					errors: [],
				}),
			),
		);

		const batch = makeBatch(["s1", "s2", "s3", "s4"]);
		const result = await runGenreTagging(makeCtx(), batch);

		expect(result).toEqual({ total: 4, succeeded: 1, failed: 3 });
		// One job_failure row per non-success outcome
		expect(mockRecordJobFailure).toHaveBeenCalledTimes(3);
	});

	it("returns failed=0 on the all-success path", async () => {
		mockEnrichBatch.mockResolvedValue(
			Result.ok(makeBatchResult({ fetched: 2, cached: 1 })),
		);

		const batch = makeBatch(["s1", "s2", "s3"]);
		const result = await runGenreTagging(makeCtx(), batch);

		expect(result).toEqual({ total: 3, succeeded: 3, failed: 0 });
		expect(mockRecordJobFailure).not.toHaveBeenCalled();
	});

	it("sums errors + notFound + unavailable when all three are present", async () => {
		mockEnrichBatch.mockResolvedValue(
			Result.ok(
				makeBatchResult({
					fetched: 1,
					errors: [["s2", "boom"]],
					notFound: ["s3"],
					unavailable: ["s4"],
				}),
			),
		);

		const batch = makeBatch(["s1", "s2", "s3", "s4"]);
		const result = await runGenreTagging(makeCtx(), batch);

		expect(result.failed).toBe(3);
		expect(result.succeeded).toBe(1);
		expect(result.total).toBe(4);
	});
});

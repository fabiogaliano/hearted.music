import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioFeature } from "@/lib/domains/enrichment/audio-features/queries";
import type { AudioFeaturesFailureKind } from "@/lib/integrations/audio/service";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import type { EnrichmentContext } from "../types";

const mockGetAudioFeaturesBatch = vi.fn();
const mockGetOrFetchFeatures = vi.fn();
const mockGetAvailability = vi.fn();
const mockEnqueueSearchJob = vi.fn();

vi.mock("@/lib/domains/enrichment/audio-features/queries", () => ({
	getBatch: (...args: unknown[]) => mockGetAudioFeaturesBatch(...args),
}));

vi.mock("@/lib/domains/enrichment/audio-feature-backfill/jobs", () => ({
	getAudioFeatureAvailability: (...args: unknown[]) =>
		mockGetAvailability(...args),
	enqueueSearchJob: (...args: unknown[]) => mockEnqueueSearchJob(...args),
}));

vi.mock("@/lib/integrations/audio/service", () => ({
	createAudioFeaturesService: () => ({
		getOrFetchFeatures: (...args: unknown[]) => mockGetOrFetchFeatures(...args),
	}),
}));

vi.mock("@/lib/integrations/reccobeats/service", () => ({
	createReccoBeatsService: () => ({}),
}));

import {
	getReadyForAudioFeatures,
	runAudioFeatures,
} from "../stages/audio-features";

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
			release_year: null,
			release_year_checked_at: null,
			vocal_gender: null,
			language: null,
			language_confidence: null,
			language_secondary: null,
			language_checked_at: null,
			image_url: null,
			spotify_id: `spotify-${id}`,
		})),
		spotifyIdBySongId: new Map(ids.map((id) => [id, `spotify-${id}`])),
	};
}

function makeCtx(): EnrichmentContext {
	return {
		accountId: "account-1",
		embeddingService: {} as EnrichmentContext["embeddingService"],
		jobId: "job-1",
	};
}

function makeAudioFeature(songId: string): AudioFeature {
	return { song_id: songId } as AudioFeature;
}

/** Default availability: every queried song is `absent` (catalog lookup OK). */
function availabilityAllAbsent() {
	mockGetAvailability.mockImplementation(async (ids: string[]) =>
		Result.ok(ids.map((songId) => ({ state: "absent", songId }))),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetAudioFeaturesBatch.mockResolvedValue(Result.ok(new Map()));
	mockGetOrFetchFeatures.mockResolvedValue(
		Result.ok({ features: new Map(), failures: new Map() }),
	);
	mockEnqueueSearchJob.mockResolvedValue(Result.ok({ id: "backfill-job-1" }));
	availabilityAllAbsent();
});

describe("getReadyForAudioFeatures", () => {
	it("separates cached from ready songs", async () => {
		const cached = new Map([["s1", makeAudioFeature("s1")]]);
		mockGetAudioFeaturesBatch.mockResolvedValue(Result.ok(cached));

		const result = await getReadyForAudioFeatures(["s1", "s2", "s3"]);

		expect(result.done).toEqual(["s1"]);
		expect(result.ready).toEqual(["s2", "s3"]);
		expect(result.notReady).toEqual([]);
	});

	it("throws when DB lookup fails", async () => {
		mockGetAudioFeaturesBatch.mockResolvedValue(
			Result.err({ message: "connection refused" }),
		);

		await expect(getReadyForAudioFeatures(["s1"])).rejects.toThrow(
			"Failed to check existing audio features",
		);
	});
});

describe("runAudioFeatures → StageOutcome", () => {
	it("returns skipped when all songs have cached features", async () => {
		const cached = new Map([
			["s1", makeAudioFeature("s1")],
			["s2", makeAudioFeature("s2")],
		]);
		mockGetAudioFeaturesBatch.mockResolvedValue(Result.ok(cached));

		const outcome = await runAudioFeatures(makeCtx(), makeBatch(["s1", "s2"]));

		expect(outcome.kind).toBe("skipped");
		expect(outcome.candidateSongIds).toEqual(["s1", "s2"]);
	});

	it("returns attempted with succeededSongIds for fetched features", async () => {
		const fetched = new Map([
			["s1", makeAudioFeature("s1")],
			["s2", makeAudioFeature("s2")],
		]);
		mockGetOrFetchFeatures.mockResolvedValue(
			Result.ok({ features: fetched, failures: new Map() }),
		);

		const outcome = await runAudioFeatures(makeCtx(), makeBatch(["s1", "s2"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.succeededSongIds).toEqual(["s1", "s2"]);
		expect(outcome.failures).toEqual([]);
		expect(outcome.attemptedSongIds).toEqual(["s1", "s2"]);
	});

	it("defers a catalog not_found by enqueueing a backfill job (no failure row)", async () => {
		const failures = new Map<string, AudioFeaturesFailureKind>([
			["s1", "not_found"],
		]);
		mockGetOrFetchFeatures.mockResolvedValue(
			Result.ok({ features: new Map(), failures }),
		);

		const outcome = await runAudioFeatures(makeCtx(), makeBatch(["s1"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.succeededSongIds).toEqual([]);
		expect(outcome.failures).toEqual([]);
		expect(outcome.deferredSongIds).toEqual(["s1"]);
		expect(mockEnqueueSearchJob).toHaveBeenCalledWith("s1", "account-1");
	});

	it("records a PROVIDER_TRANSIENT failure for a transient catalog error", async () => {
		const failures = new Map<string, AudioFeaturesFailureKind>([
			["s2", "transient"],
		]);
		mockGetOrFetchFeatures.mockResolvedValue(
			Result.ok({ features: new Map(), failures }),
		);

		const outcome = await runAudioFeatures(makeCtx(), makeBatch(["s2"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.failures).toEqual([
			{
				songId: "s2",
				failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
				message: "Audio features provider transient failure",
			},
		]);
		expect(mockEnqueueSearchJob).not.toHaveBeenCalled();
	});

	it("defaults unknown failure kinds to PROVIDER_TRANSIENT", async () => {
		mockGetOrFetchFeatures.mockResolvedValue(
			Result.ok({ features: new Map(), failures: new Map() }),
		);

		const outcome = await runAudioFeatures(makeCtx(), makeBatch(["s1"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.failures).toEqual([
			{
				songId: "s1",
				failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
				message: "Audio features provider transient failure",
			},
		]);
	});

	it("mixes succeeded and deferred songs in the same outcome", async () => {
		const features = new Map([["s1", makeAudioFeature("s1")]]);
		const failures = new Map<string, AudioFeaturesFailureKind>([
			["s2", "not_found"],
		]);
		mockGetOrFetchFeatures.mockResolvedValue(Result.ok({ features, failures }));

		const outcome = await runAudioFeatures(makeCtx(), makeBatch(["s1", "s2"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.succeededSongIds).toEqual(["s1"]);
		expect(outcome.deferredSongIds).toEqual(["s2"]);
		expect(outcome.failures).toEqual([]);
	});

	it("defers a song whose backfill is already active without calling the catalog", async () => {
		mockGetAvailability.mockResolvedValue(
			Result.ok([{ state: "backfill_active", songId: "s1", jobId: "j1" }]),
		);

		const outcome = await runAudioFeatures(makeCtx(), makeBatch(["s1"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.deferredSongIds).toEqual(["s1"]);
		expect(mockGetOrFetchFeatures).not.toHaveBeenCalled();
		expect(mockEnqueueSearchJob).not.toHaveBeenCalled();
	});

	it("treats manual_needed / terminal as deferred without re-searching", async () => {
		mockGetAvailability.mockResolvedValue(
			Result.ok([
				{ state: "manual_needed", songId: "s1", jobId: "j1", errorCode: null },
				{
					state: "unavailable_terminal",
					songId: "s2",
					jobId: "j2",
					errorCode: null,
				},
			]),
		);

		const outcome = await runAudioFeatures(makeCtx(), makeBatch(["s1", "s2"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.deferredSongIds).toEqual(["s1", "s2"]);
		expect(mockGetOrFetchFeatures).not.toHaveBeenCalled();
		expect(mockEnqueueSearchJob).not.toHaveBeenCalled();
	});

	it("excludes cached songs from attemptedSongIds", async () => {
		const cached = new Map([["s1", makeAudioFeature("s1")]]);
		mockGetAudioFeaturesBatch.mockResolvedValue(Result.ok(cached));

		const features = new Map([["s2", makeAudioFeature("s2")]]);
		mockGetOrFetchFeatures.mockResolvedValue(
			Result.ok({ features, failures: new Map() }),
		);

		const outcome = await runAudioFeatures(makeCtx(), makeBatch(["s1", "s2"]));

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") throw new Error("unreachable");
		expect(outcome.candidateSongIds).toEqual(["s1", "s2"]);
		expect(outcome.attemptedSongIds).toEqual(["s2"]);
		expect(outcome.succeededSongIds).toEqual(["s2"]);
	});

	it("throws when a song in the ready set lacks a Spotify ID", async () => {
		const batch: PipelineBatch = {
			songIds: ["s1"],
			songs: [],
			spotifyIdBySongId: new Map(),
		};

		await expect(runAudioFeatures(makeCtx(), batch)).rejects.toThrow(
			"Missing Spotify ID for song s1",
		);
	});

	it("throws when an audio-feature provider call fails", async () => {
		mockGetOrFetchFeatures.mockRejectedValue(
			new Error("ReccoBeats API timeout"),
		);

		const batch = makeBatch(["s1", "s2", "s3"]);

		// Throwing is the contract the orchestrator relies on: runStageWithAccounting
		// catches the throw and expands it to per-candidate failure rows.
		await expect(runAudioFeatures(makeCtx(), batch)).rejects.toThrow(
			"ReccoBeats API timeout",
		);
	});
});

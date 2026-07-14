import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetEntitledSongIds = vi.fn();
vi.mock("@/lib/workflows/enrichment-pipeline/batch", () => ({
	getEntitledDataEnrichedSongIds: (...args: unknown[]) =>
		mockGetEntitledSongIds(...args),
}));

const mockGetByIds = vi.fn();
vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: (...args: unknown[]) => mockGetByIds(...args),
}));

const mockGetBatch = vi.fn();
vi.mock("@/lib/domains/enrichment/audio-features/queries", () => ({
	getBatch: (...args: unknown[]) => mockGetBatch(...args),
}));

const mockLoadExclusionSet = vi.fn();
vi.mock("@/lib/workflows/enrichment-pipeline/stages/matching", () => ({
	loadExclusionSet: (...args: unknown[]) => mockLoadExclusionSet(...args),
}));

const { loadCandidateSongIds, loadCandidateDetails, loadSongEmbeddings } =
	await import("../candidate-loading");

function makeSongRow(id: string) {
	return {
		id,
		spotify_id: `sp-${id}`,
		name: `Song ${id}`,
		artists: ["Artist"],
		genres: ["pop"],
	};
}

describe("loadCandidateSongIds", () => {
	beforeEach(() => vi.clearAllMocks());

	it("delegates to getEntitledDataEnrichedSongIds", async () => {
		mockGetEntitledSongIds.mockResolvedValue(["s1", "s2"]);
		const ids = await loadCandidateSongIds("acc-1");
		expect(ids).toEqual(["s1", "s2"]);
		expect(mockGetEntitledSongIds).toHaveBeenCalledWith("acc-1");
	});
});

describe("loadCandidateDetails", () => {
	beforeEach(() => vi.clearAllMocks());

	it("builds MatchingSong[] with audio features attached when present", async () => {
		mockGetByIds.mockResolvedValue(Result.ok([makeSongRow("s1")]));
		mockGetBatch.mockResolvedValue(
			Result.ok(
				new Map([
					[
						"s1",
						{
							energy: 0.5,
							valence: 0.4,
							danceability: 0.3,
							acousticness: 0.2,
							instrumentalness: 0.1,
							speechiness: 0.05,
							liveness: 0.15,
							tempo: 120,
							loudness: -5,
						},
					],
				]),
			),
		);
		mockLoadExclusionSet.mockResolvedValue(new Set(["s1:p1"]));

		const { matchingSongs, baseExclusionSet } = await loadCandidateDetails(
			"acc-1",
			["s1"],
			"test-user",
		);

		expect(matchingSongs).toHaveLength(1);
		expect(matchingSongs[0].audioFeatures?.tempo).toBe(120);
		expect(baseExclusionSet.has("s1:p1")).toBe(true);
	});

	it("sets audioFeatures to null when the audio-feature row is missing", async () => {
		mockGetByIds.mockResolvedValue(Result.ok([makeSongRow("s1")]));
		mockGetBatch.mockResolvedValue(Result.ok(new Map()));
		mockLoadExclusionSet.mockResolvedValue(new Set());

		const { matchingSongs } = await loadCandidateDetails(
			"acc-1",
			["s1"],
			"test-user",
		);

		expect(matchingSongs[0].audioFeatures).toBeNull();
	});

	it("degrades to an empty audio-feature map (not a throw) on audio-feature load failure", async () => {
		mockGetByIds.mockResolvedValue(Result.ok([makeSongRow("s1")]));
		mockGetBatch.mockResolvedValue(
			Result.err(new Error("audio features down")),
		);
		mockLoadExclusionSet.mockResolvedValue(new Set());

		const { matchingSongs } = await loadCandidateDetails(
			"acc-1",
			["s1"],
			"test-user",
		);

		expect(matchingSongs[0].audioFeatures).toBeNull();
	});

	it("throws when the song rows themselves fail to load", async () => {
		mockGetByIds.mockResolvedValue(Result.err(new Error("db down")));
		mockGetBatch.mockResolvedValue(Result.ok(new Map()));
		mockLoadExclusionSet.mockResolvedValue(new Set());

		await expect(
			loadCandidateDetails("acc-1", ["s1"], "test-user"),
		).rejects.toThrow("[target-refresh] Failed to load songs");
	});

	it("degrades to an empty exclusion set when loadExclusionSet rejects", async () => {
		mockGetByIds.mockResolvedValue(Result.ok([makeSongRow("s1")]));
		mockGetBatch.mockResolvedValue(Result.ok(new Map()));
		mockLoadExclusionSet.mockRejectedValue(new Error("DB timeout"));

		const { baseExclusionSet } = await loadCandidateDetails(
			"acc-1",
			["s1"],
			"test-user",
		);

		expect(baseExclusionSet.size).toBe(0);
	});
});

describe("loadSongEmbeddings", () => {
	beforeEach(() => vi.clearAllMocks());

	function makeEmbeddingService(
		getEmbeddings: (...args: unknown[]) => unknown,
	) {
		return { getEmbeddings, getEmbedding: vi.fn() } as never;
	}

	it("parses stringified embeddings and keeps numeric arrays", async () => {
		const service = makeEmbeddingService(() =>
			Promise.resolve(
				Result.ok(new Map([["s1", { embedding: JSON.stringify([0.1, 0.2]) }]])),
			),
		);

		const embeddings = await loadSongEmbeddings(service, ["s1"], "test-user");

		expect(embeddings.get("s1")).toEqual([0.1, 0.2]);
	});

	it("skips a row whose embedding is corrupt JSON without throwing", async () => {
		const service = makeEmbeddingService(() =>
			Promise.resolve(Result.ok(new Map([["s1", { embedding: "{not json" }]]))),
		);

		const embeddings = await loadSongEmbeddings(service, ["s1"], "test-user");

		expect(embeddings.has("s1")).toBe(false);
	});

	it("skips a row whose parsed embedding is not a numeric array", async () => {
		const service = makeEmbeddingService(() =>
			Promise.resolve(
				Result.ok(new Map([["s1", { embedding: JSON.stringify(["a", "b"]) }]])),
			),
		);

		const embeddings = await loadSongEmbeddings(service, ["s1"], "test-user");

		expect(embeddings.has("s1")).toBe(false);
	});

	it("returns an empty map when the embedding fetch itself errors", async () => {
		const service = makeEmbeddingService(() =>
			Promise.resolve(Result.err(new Error("provider down"))),
		);

		const embeddings = await loadSongEmbeddings(service, ["s1"], "test-user");

		expect(embeddings.size).toBe(0);
	});
});

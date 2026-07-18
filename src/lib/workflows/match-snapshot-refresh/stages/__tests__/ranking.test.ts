import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSongAnalyses = vi.fn();
vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	get: (...args: unknown[]) => mockGetSongAnalyses(...args),
}));

vi.mock("@/lib/domains/enrichment/embeddings/analysis-text", () => ({
	flattenAnalysisText: vi.fn().mockReturnValue(""),
}));

const mockRankMatchSuggestionLists = vi.fn();
vi.mock("@/lib/workflows/enrichment-pipeline/match-ranking", () => ({
	rankMatchSuggestionLists: (...args: unknown[]) =>
		mockRankMatchSuggestionLists(...args),
}));

const { runOrientedRanking } = await import("../ranking");

function storedPair(songId: string, playlistId: string, fusedScore: number) {
	return {
		songId,
		playlistId,
		score: fusedScore,
		fusedScore,
		rank: 1,
		factors: { embedding: 0.9, audio: 0.5, genre: 0.3 },
		normalizedFactors: { embedding: 0.81, audio: 0.44, genre: 0.27 },
		confidence: fusedScore,
		fromCache: false,
	};
}

describe("runOrientedRanking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetSongAnalyses.mockResolvedValue(Result.ok(new Map()));
	});

	it("returns completed with empty resultEntries and metadata mode when storedPairs is empty", async () => {
		const outcome = await runOrientedRanking({
			who: "test-user",
			storedPairs: [],
			matchingSongs: [],
			playlists: [],
			rerankerService: {} as never,
		});

		expect(outcome).toEqual({
			status: "completed",
			resultEntries: [],
			rerankDocumentMode: "metadata",
		});
		expect(mockRankMatchSuggestionLists).not.toHaveBeenCalled();
	});

	it("returns superseded without building resultEntries when ranking is superseded", async () => {
		mockRankMatchSuggestionLists.mockResolvedValue({
			status: "superseded",
			byOrientation: new Map(),
		});

		const outcome = await runOrientedRanking({
			who: "test-user",
			storedPairs: [storedPair("s1", "p1", 0.72)],
			matchingSongs: [{ id: "s1", name: "Song", artists: [], genres: [] }],
			playlists: [{ id: "p1", name: "Playlist" }],
			rerankerService: {} as never,
		});

		expect(outcome).toEqual({ status: "superseded" });
	});

	it("mirrors song-orientation rank/score onto the legacy columns (C12) and includes both orientations' rows", async () => {
		mockRankMatchSuggestionLists.mockResolvedValue({
			status: "completed",
			byOrientation: new Map([
				[
					"song",
					[
						{
							orientation: "song",
							subjectId: "s1",
							rankedPairs: [
								{
									songId: "s1",
									playlistId: "p1",
									orderingScore: 0.88,
									rerankerScore: 0.79,
									source: "rerank",
									documentMode: "analysis",
								},
							],
						},
					],
				],
				[
					"playlist",
					[
						{
							orientation: "playlist",
							subjectId: "p1",
							rankedPairs: [
								{
									songId: "s1",
									playlistId: "p1",
									orderingScore: 0.85,
									rerankerScore: null,
									source: "fused_fallback",
									documentMode: "metadata",
								},
							],
						},
					],
				],
			]),
		});

		const outcome = await runOrientedRanking({
			who: "test-user",
			storedPairs: [storedPair("s1", "p1", 0.72)],
			matchingSongs: [{ id: "s1", name: "Song", artists: [], genres: [] }],
			playlists: [{ id: "p1", name: "Playlist" }],
			rerankerService: {} as never,
		});

		expect(outcome.status).toBe("completed");
		if (outcome.status !== "completed") return;

		expect(outcome.resultEntries).toHaveLength(1);
		const entry = outcome.resultEntries[0];
		expect(entry.rankings).toHaveLength(2);
		expect(entry.score).toBe(0.88);
		expect(entry.rank).toBe(1);
	});

	it("falls back to fusedScore/null rank when no song-orientation row exists for the pair", async () => {
		mockRankMatchSuggestionLists.mockResolvedValue({
			status: "completed",
			byOrientation: new Map([["playlist", []]]),
		});

		const outcome = await runOrientedRanking({
			who: "test-user",
			storedPairs: [storedPair("s1", "p1", 0.72)],
			matchingSongs: [{ id: "s1", name: "Song", artists: [], genres: [] }],
			playlists: [{ id: "p1", name: "Playlist" }],
			rerankerService: {} as never,
		});

		expect(outcome.status).toBe("completed");
		if (outcome.status !== "completed") return;
		expect(outcome.resultEntries[0].score).toBe(0.72);
		expect(outcome.resultEntries[0].rank).toBeNull();
	});

	it("sets rerankDocumentMode to analysis when analysis text is available", async () => {
		mockGetSongAnalyses.mockResolvedValue(
			Result.ok(new Map([["s1", { some: "analysis" }]])),
		);
		const { flattenAnalysisText } = await import(
			"@/lib/domains/enrichment/embeddings/analysis-text"
		);
		vi.mocked(flattenAnalysisText).mockReturnValue("some analysis prose");
		mockRankMatchSuggestionLists.mockResolvedValue({
			status: "completed",
			byOrientation: new Map(),
		});

		const outcome = await runOrientedRanking({
			who: "test-user",
			storedPairs: [storedPair("s1", "p1", 0.72)],
			matchingSongs: [{ id: "s1", name: "Song", artists: [], genres: [] }],
			playlists: [{ id: "p1", name: "Playlist" }],
			rerankerService: {} as never,
		});

		expect(outcome.status).toBe("completed");
		if (outcome.status !== "completed") return;
		expect(outcome.rerankDocumentMode).toBe("analysis");
	});
});

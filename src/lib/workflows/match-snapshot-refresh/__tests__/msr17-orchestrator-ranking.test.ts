/**
 * MSR-17 — orchestrator ranking integration tests.
 *
 * Covers:
 *   - Superseded ranking result returns early without calling writeMatchSnapshot.
 *   - Completed ranking result passes ranking rows and score/rank mirror (C12)
 *     through to writeMatchSnapshot.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRankMatchSuggestionLists = vi.fn();
vi.mock("@/lib/workflows/enrichment-pipeline/match-ranking", () => ({
	rankMatchSuggestionLists: (...args: unknown[]) =>
		mockRankMatchSuggestionLists(...args),
	MATCH_RANKING_ORIENTATIONS: ["song", "playlist"],
	MATCH_RANKING_SCHEMA_VERSION: "oriented-suggestion-lists-v1",
	RERANK_INSTRUCTION_BY_ORIENTATION: { song: "default", playlist: "playlist" },
	buildSongRerankDocument: vi
		.fn()
		.mockReturnValue({ document: "d", documentMode: "metadata" }),
	buildPlaylistRerankDocument: vi
		.fn()
		.mockReturnValue({ document: "d", documentMode: "metadata" }),
}));

const mockMatchBatch = vi.fn();
vi.mock("@/lib/domains/taste/song-matching/service", () => ({
	createMatchingService: () => ({
		matchBatch: (...args: unknown[]) => mockMatchBatch(...args),
	}),
}));

const mockWriteMatchSnapshot = vi.fn();
const mockWriteEmptySnapshot = vi.fn();
vi.mock("../write-match-snapshot", () => ({
	writeMatchSnapshot: (...args: unknown[]) => mockWriteMatchSnapshot(...args),
	writeEmptySnapshot: (...args: unknown[]) => mockWriteEmptySnapshot(...args),
}));

vi.mock("@/lib/workflows/enrichment-pipeline/batch", () => ({
	getEntitledDataEnrichedSongIds: vi.fn().mockResolvedValue(["song-1"]),
}));

vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: vi.fn().mockResolvedValue(
		Result.ok([
			{
				id: "song-1",
				spotify_id: "sp-1",
				name: "Song 1",
				artists: ["Artist"],
				genres: ["pop"],
			},
		]),
	),
}));

vi.mock("@/lib/domains/enrichment/audio-features/queries", () => ({
	getBatch: vi.fn().mockResolvedValue(Result.ok(new Map())),
}));

vi.mock("@/lib/domains/enrichment/content-analysis/queries", () => ({
	get: vi.fn().mockResolvedValue(Result.ok(new Map())),
}));

vi.mock("@/lib/domains/enrichment/embeddings/service", () => ({
	EmbeddingService: {
		create: () =>
			Result.ok({
				getEmbeddings: vi.fn().mockResolvedValue(Result.ok(new Map())),
				getEmbedding: vi.fn(),
			}),
	},
}));

vi.mock("../profiles", () => ({
	loadTargetPlaylistProfiles: vi.fn().mockResolvedValue({
		playlists: [
			{
				id: "pl-1",
				name: "Playlist 1",
				match_intent: null,
				genre_pills: null,
				match_filters: { version: 1 },
			},
		],
		profiles: [
			{
				playlistId: "pl-1",
				embedding: [0.1],
				audioCentroid: {},
				genreDistribution: {},
				hasGenrePills: false,
			},
		],
	}),
}));

vi.mock("@/lib/domains/taste/playlist-profiling/service", () => ({
	createPlaylistProfilingService: () => ({}),
}));

vi.mock("@/lib/integrations/llm/service", () => ({
	createLlmService: () => {
		throw new Error("LLM unavailable");
	},
}));

vi.mock("@/lib/integrations/reranker/service", () => ({
	RerankerService: class {
		rerank() {
			return Promise.resolve(
				Result.ok({
					reranked: false,
					candidates: [],
					rerankedCount: 0,
					stats: { originalTopScore: 0, rerankTopScore: 0, scoreShift: 0 },
				}),
			);
		}
	},
	DEFAULT_RERANKER_CONFIG: {},
}));

vi.mock("@/lib/workflows/enrichment-pipeline/stages/matching", () => ({
	loadExclusionSet: vi.fn().mockResolvedValue(new Set()),
}));

vi.mock("../match-filter-exclusions", () => ({
	loadMatchFilterExclusions: vi.fn().mockResolvedValue({
		exclusions: new Set(),
		summary: {
			activeFilterPlaylistCount: 0,
			candidatePairCount: 0,
			excludedPairCount: 0,
			failedChecksByType: {
				languages: 0,
				releaseYear: 0,
				likedAt: 0,
				vocalGender: 0,
			},
			excludedPairsByPlaylist: {},
			invalidStoredFiltersByPlaylist: {},
			degraded: { baseExclusions: false, filterMetadata: false },
		},
	}),
}));

vi.mock("@/lib/workflows/playlist-sync/lightweight-enrichment", () => ({
	runLightweightEnrichment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/platform/jobs/repository", () => ({
	updateJobProgress: vi.fn().mockResolvedValue(Result.ok(undefined)),
}));

vi.mock("@/lib/observability/account-label", () => ({
	resolveAccountLabel: vi.fn().mockResolvedValue("test-user"),
}));

vi.mock("@/lib/domains/enrichment/embeddings/analysis-text", () => ({
	flattenAnalysisText: vi.fn().mockReturnValue(""),
}));

// retainStoredMatchPairs returns one stored pair so the ranking block is
// exercised (storedPairs.length > 0).
vi.mock("@/lib/domains/taste/song-matching/retention", () => ({
	retainStoredMatchPairs: vi.fn().mockReturnValue([
		{
			songId: "song-1",
			playlistId: "pl-1",
			fusedScore: 0.72,
			score: 0.72,
			rank: 1,
			factors: { embedding: 0.9, audio: 0.5, genre: 0.3 },
			normalizedFactors: { embedding: 0.81, audio: 0.44, genre: 0.27 },
			confidence: 0.9,
			fromCache: false,
		},
	]),
	MATCH_STORED_PAIRS_PER_SONG: 10,
	MATCH_STORED_PAIRS_PER_PLAYLIST: 10,
}));

const { executeMatchSnapshotRefresh } = await import("../orchestrator");

function makeMatchResult() {
	return Result.ok({
		matches: new Map([
			[
				"song-1",
				[
					{
						songId: "song-1",
						playlistId: "pl-1",
						score: 0.72,
						fusedScore: 0.72,
						rank: 1,
						factors: { embedding: 0.9, audio: 0.5, genre: 0.3 },
						normalizedFactors: { embedding: 0.81, audio: 0.44, genre: 0.27 },
						confidence: 0.9,
						fromCache: false,
					},
				],
			],
		]),
	});
}

const defaultWriteResult = {
	published: true,
	snapshotId: "snap-1",
	matchedSongCount: 1,
	candidateCount: 1,
	playlistCount: 1,
	isEmpty: false,
	noOp: false,
};

describe("executeMatchSnapshotRefresh — ranking (MSR-17)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockMatchBatch.mockResolvedValue(makeMatchResult());
		mockWriteMatchSnapshot.mockResolvedValue(defaultWriteResult);
	});

	it("returns superseded without calling writeMatchSnapshot when ranking is superseded", async () => {
		mockRankMatchSuggestionLists.mockResolvedValue({
			status: "superseded",
			byOrientation: new Map(),
		});

		const outcome = await executeMatchSnapshotRefresh("acc-1", {
			needsTargetSongEnrichment: false,
		});

		expect(outcome.status).toBe("superseded");
		expect(mockWriteMatchSnapshot).not.toHaveBeenCalled();
	});

	it("proceeds to publish and passes ranking rows to writeMatchSnapshot when completed", async () => {
		mockRankMatchSuggestionLists.mockResolvedValue({
			status: "completed",
			byOrientation: new Map([
				[
					"song",
					[
						{
							orientation: "song",
							subjectId: "song-1",
							rankedPairs: [
								{
									songId: "song-1",
									playlistId: "pl-1",
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
							subjectId: "pl-1",
							rankedPairs: [
								{
									songId: "song-1",
									playlistId: "pl-1",
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

		const outcome = await executeMatchSnapshotRefresh("acc-1", {
			needsTargetSongEnrichment: false,
		});

		expect(outcome.status).toBe("published");
		expect(mockWriteMatchSnapshot).toHaveBeenCalledOnce();

		const [writeOpts] = mockWriteMatchSnapshot.mock.calls[0] as [
			{
				results: Array<{
					song_id: string;
					score: number;
					rank: number | null;
					rankings?: Array<{
						orientation: string;
						rank: number;
						ordering_score: number;
					}>;
				}>;
			},
		];

		expect(writeOpts.results).toHaveLength(1);
		const entry = writeOpts.results[0];

		// Both orientations should produce ranking rows (2 total).
		expect(entry.rankings).toHaveLength(2);

		// Legacy score/rank mirror from song-orientation (C12).
		expect(entry.score).toBe(0.88);
		expect(entry.rank).toBe(1);
	});

	it("sets score to fusedScore when no song-orientation ranking exists for the pair", async () => {
		// ranking returns no song-orientation rows (empty map) — fallback path.
		mockRankMatchSuggestionLists.mockResolvedValue({
			status: "completed",
			byOrientation: new Map([["playlist", []]]),
		});

		const outcome = await executeMatchSnapshotRefresh("acc-1", {
			needsTargetSongEnrichment: false,
		});

		expect(outcome.status).toBe("published");
		const [writeOpts] = mockWriteMatchSnapshot.mock.calls[0] as [
			{ results: Array<{ score: number; rank: number | null }> },
		];

		// Falls back to fusedScore=0.72 with null rank.
		expect(writeOpts.results[0].score).toBe(0.72);
		expect(writeOpts.results[0].rank).toBeNull();
	});
});

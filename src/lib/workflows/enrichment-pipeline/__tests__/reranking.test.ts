import { Result } from "better-result";
import { assert, describe, expect, it, vi } from "vitest";
import type {
	MatchingSong,
	MatchResult,
} from "@/lib/domains/taste/song-matching/types";
import type { RerankerService } from "@/lib/integrations/reranker/service";
import { rerankMatches } from "../reranking";

const songs: MatchingSong[] = [
	{
		id: "s1",
		spotifyId: "sp1",
		name: "Alpha Song",
		artists: ["Artist A"],
		genres: ["pop"],
	},
	{
		id: "s2",
		spotifyId: "sp2",
		name: "Beta Song",
		artists: ["Artist B"],
		genres: ["rock"],
	},
];

const playlists = [
	{ id: "pl1", name: "Chill Vibes", description: "relaxing music" },
];

function makeMatch(
	songId: string,
	playlistId: string,
	score: number,
	rank: number,
): MatchResult {
	return {
		songId,
		playlistId,
		score,
		rank,
		factors: { embedding: score, audio: 0, genre: 0 },
		confidence: 1,
		fromCache: false,
	};
}

function createMockReranker(scoreMap: Map<string, number>): RerankerService {
	return {
		rerank: vi.fn().mockResolvedValue(
			Result.ok({
				candidates: Array.from(scoreMap.entries()).map(([id, score]) => ({
					id,
					score,
					document: "",
				})),
				reranked: true,
				rerankedCount: scoreMap.size,
				stats: {
					originalTopScore: 0.8,
					rerankTopScore: 0.9,
					scoreShift: 0.1,
				},
			}),
		),
	} as unknown as RerankerService;
}

describe("rerankMatches", () => {
	it("reranking changes scores and re-sorts results", async () => {
		const matches = new Map<string, MatchResult[]>();
		matches.set("s1", [makeMatch("s1", "pl1", 0.8, 1)]);
		matches.set("s2", [makeMatch("s2", "pl1", 0.6, 2)]);

		// Reranker gives s2 a higher score than s1
		const reranker = createMockReranker(
			new Map([
				["s1", 0.3],
				["s2", 0.95],
			]),
		);

		await rerankMatches(matches, songs, playlists, reranker);

		// s1's score should now be the reranked score
		const s1Results = matches.get("s1");
		assert(s1Results !== undefined);
		expect(s1Results[0].score).toBe(0.3);

		// s2's score should be updated too
		const s2Results = matches.get("s2");
		assert(s2Results !== undefined);
		expect(s2Results[0].score).toBe(0.95);
	});

	it("gracefully handles reranker failure", async () => {
		const matches = new Map<string, MatchResult[]>();
		matches.set("s1", [makeMatch("s1", "pl1", 0.8, 1)]);

		const failingReranker = {
			rerank: vi
				.fn()
				.mockResolvedValue(Result.err({ message: "Reranker unavailable" })),
		} as unknown as RerankerService;

		await rerankMatches(matches, songs, playlists, failingReranker);

		// Scores should be unchanged
		const s1 = matches.get("s1");
		assert(s1 !== undefined);
		expect(s1[0].score).toBe(0.8);
	});

	it("handles reranker returning reranked: false", async () => {
		const matches = new Map<string, MatchResult[]>();
		matches.set("s1", [makeMatch("s1", "pl1", 0.8, 1)]);

		const skippingReranker = {
			rerank: vi.fn().mockResolvedValue(
				Result.ok({
					candidates: [],
					reranked: false,
					rerankedCount: 0,
					stats: {
						originalTopScore: 0.8,
						rerankTopScore: 0.8,
						scoreShift: 0,
					},
				}),
			),
		} as unknown as RerankerService;

		await rerankMatches(matches, songs, playlists, skippingReranker);

		// Scores should be unchanged
		const s1 = matches.get("s1");
		assert(s1 !== undefined);
		expect(s1[0].score).toBe(0.8);
	});

	it("passes candidates to reranker in descending base-score order", async () => {
		const matches = new Map<string, MatchResult[]>();
		matches.set("s1", [makeMatch("s1", "pl1", 0.2, 1)]);
		matches.set("s2", [makeMatch("s2", "pl1", 0.9, 1)]);

		const inspectingReranker = {
			rerank: vi.fn().mockImplementation(async (_query, candidates) => {
				expect(
					candidates.map((candidate: { id: string }) => candidate.id),
				).toEqual(["s2", "s1"]);
				return Result.ok({
					candidates,
					reranked: true,
					rerankedCount: candidates.length,
					stats: {
						originalTopScore: 0.9,
						rerankTopScore: 0.9,
						scoreShift: 0,
					},
				});
			}),
		} as unknown as RerankerService;

		await rerankMatches(matches, songs, playlists, inspectingReranker);

		expect(inspectingReranker.rerank).toHaveBeenCalledOnce();
	});
});

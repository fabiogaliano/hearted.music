import { Result } from "better-result";
import { assert, describe, expect, it, vi } from "vitest";
import type {
	MatchingSong,
	MatchResult,
} from "@/lib/domains/taste/song-matching/types";
import type { RerankerService } from "@/lib/integrations/reranker/service";
import { rerankMatches } from "../reranking";

// Character cap from reranking.ts — tests should match the real constant.
const ANALYSIS_TAIL_MAX_CHARS = 1600;

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
	{ id: "pl1", name: "Chill Vibes", match_intent: "relaxing music" },
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
		normalizedFactors: { embedding: score, audio: 0, genre: 0 },
		fusedScore: score,
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
		// fusedScore is the pre-rerank retrieval score and must survive the overwrite.
		expect(s1Results[0].fusedScore).toBe(0.8);
		expect(s1Results[0].rerankedScore).toBe(0.3);

		// s2's score should be updated too
		const s2Results = matches.get("s2");
		assert(s2Results !== undefined);
		expect(s2Results[0].score).toBe(0.95);
		expect(s2Results[0].fusedScore).toBe(0.6);
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

	describe("document construction", () => {
		function captureDocuments(scoreMap: Map<string, number>) {
			let capturedCandidates: Array<{ id: string; document: string }> = [];
			const reranker = {
				rerank: vi.fn().mockImplementation(async (_query, candidates) => {
					capturedCandidates = candidates;
					return Result.ok({
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
					});
				}),
			} as unknown as RerankerService;
			return { reranker, getCandidates: () => capturedCandidates };
		}

		it("builds metadata-only document when analysisText map is empty", async () => {
			const matches = new Map<string, MatchResult[]>();
			matches.set("s1", [makeMatch("s1", "pl1", 0.8, 1)]);

			const scoreMap = new Map([["s1", 0.9]]);
			const { reranker, getCandidates } = captureDocuments(scoreMap);

			await rerankMatches(matches, songs, playlists, reranker, new Map());

			const docs = getCandidates();
			expect(docs[0].document).toBe("Alpha Song by Artist A. Genres: pop.");
			// No analysis block appended
			expect(docs[0].document).not.toContain("\n\n");
		});

		it("appends analysis text when analysisText map has an entry for the song", async () => {
			const matches = new Map<string, MatchResult[]>();
			matches.set("s1", [makeMatch("s1", "pl1", 0.8, 1)]);

			const scoreMap = new Map([["s1", 0.9]]);
			const { reranker, getCandidates } = captureDocuments(scoreMap);
			const analysisText = new Map([["s1", "Dreamy pop with layered synths"]]);

			await rerankMatches(matches, songs, playlists, reranker, analysisText);

			const docs = getCandidates();
			expect(docs[0].document).toBe(
				"Alpha Song by Artist A. Genres: pop.\n\nDreamy pop with layered synths",
			);
		});

		it("falls back to metadata-only for songs missing from the analysisText map", async () => {
			const matches = new Map<string, MatchResult[]>();
			matches.set("s1", [makeMatch("s1", "pl1", 0.8, 1)]);
			matches.set("s2", [makeMatch("s2", "pl1", 0.6, 2)]);

			const scoreMap = new Map([
				["s1", 0.9],
				["s2", 0.7],
			]);
			const { reranker, getCandidates } = captureDocuments(scoreMap);
			// Only s1 has analysis
			const analysisText = new Map([["s1", "Bright pop energy"]]);

			await rerankMatches(matches, songs, playlists, reranker, analysisText);

			const docs = getCandidates();
			const s1Doc = docs.find((c) => c.id === "s1");
			const s2Doc = docs.find((c) => c.id === "s2");

			expect(s1Doc?.document).toContain("\n\nBright pop energy");
			// s2 falls back to metadata only
			expect(s2Doc?.document).toBe("Beta Song by Artist B. Genres: rock.");
			expect(s2Doc?.document).not.toContain("\n\n");
		});

		it("truncates analysis tail at a word boundary when it exceeds the char cap", async () => {
			const matches = new Map<string, MatchResult[]>();
			matches.set("s1", [makeMatch("s1", "pl1", 0.8, 1)]);

			const scoreMap = new Map([["s1", 0.9]]);
			const { reranker, getCandidates } = captureDocuments(scoreMap);

			// Build a long analysis string that exceeds ANALYSIS_TAIL_MAX_CHARS
			const wordCount = Math.ceil(ANALYSIS_TAIL_MAX_CHARS / 5) + 50;
			const longAnalysis = Array.from(
				{ length: wordCount },
				(_, i) => `word${i}`,
			).join(" ");
			expect(longAnalysis.length).toBeGreaterThan(ANALYSIS_TAIL_MAX_CHARS);

			const analysisText = new Map([["s1", longAnalysis]]);

			await rerankMatches(matches, songs, playlists, reranker, analysisText);

			const docs = getCandidates();
			const [prefix, tail] = docs[0].document.split("\n\n");

			// Prefix (metadata) is never truncated
			expect(prefix).toBe("Alpha Song by Artist A. Genres: pop.");

			// Tail must be within the cap
			expect(tail.length).toBeLessThanOrEqual(ANALYSIS_TAIL_MAX_CHARS);

			// Tail must end on a word boundary: the last "word" in the tail must be
			// a complete "wordN" token (not a partial slice like "word2"). Since all
			// words in the fixture are "wordN", any partial slice would look like a
			// substring of a number. We verify by checking that re-joining the words in
			// the original source always finds the last tail-word as a whole token.
			const tailWords = tail.split(" ");
			const lastWord = tailWords[tailWords.length - 1];
			// lastWord must appear as a complete word in the original long analysis
			expect(longAnalysis.split(" ")).toContain(lastWord);
		});

		it("defaults to metadata-only documents when the analysisText argument is omitted", async () => {
			const matches = new Map<string, MatchResult[]>();
			matches.set("s1", [makeMatch("s1", "pl1", 0.8, 1)]);

			const scoreMap = new Map([["s1", 0.9]]);
			const { reranker, getCandidates } = captureDocuments(scoreMap);

			// Call without the 5th argument
			await rerankMatches(matches, songs, playlists, reranker);

			const docs = getCandidates();
			expect(docs[0].document).toBe("Alpha Song by Artist A. Genres: pop.");
		});
	});
});

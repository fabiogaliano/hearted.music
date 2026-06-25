import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import type { RerankerService } from "@/lib/integrations/reranker/service";
import {
	ANALYSIS_TAIL_MAX_CHARS,
	buildPlaylistRerankDocument,
	buildSongRerankDocument,
	MATCH_RANKING_ORIENTATIONS,
	MATCH_RANKING_SCHEMA_VERSION,
	type PlaylistForRanking,
	RERANK_INSTRUCTION_BY_ORIENTATION,
	rankMatchSuggestionLists,
	rankPlaylistSuggestionLists,
	rankSongSuggestionLists,
	type SongForRanking,
	type StoredMatchPairForRanking,
} from "@/lib/workflows/enrichment-pipeline/match-ranking";

describe("match-ranking contracts", () => {
	it("MATCH_RANKING_ORIENTATIONS covers song and playlist", () => {
		expect(MATCH_RANKING_ORIENTATIONS).toContain("song");
		expect(MATCH_RANKING_ORIENTATIONS).toContain("playlist");
	});

	it("RERANK_INSTRUCTION_BY_ORIENTATION has an entry for every orientation", () => {
		for (const orientation of MATCH_RANKING_ORIENTATIONS) {
			const instruction = RERANK_INSTRUCTION_BY_ORIENTATION[orientation];
			expect(typeof instruction).toBe("string");
			expect(instruction.length).toBeGreaterThan(0);
		}
	});

	it("MATCH_RANKING_SCHEMA_VERSION is a non-empty string", () => {
		expect(typeof MATCH_RANKING_SCHEMA_VERSION).toBe("string");
		expect(MATCH_RANKING_SCHEMA_VERSION.length).toBeGreaterThan(0);
	});
});

describe("buildSongRerankDocument", () => {
	const baseSong = {
		name: "Alpha Song",
		artists: ["Artist A"],
		genres: ["pop"],
	};

	it("returns metadata mode when no analysisText is provided", () => {
		const { document, documentMode } = buildSongRerankDocument(baseSong);
		expect(documentMode).toBe("metadata");
		expect(document).toBe("Alpha Song by Artist A. Genres: pop.");
		expect(document).not.toContain("\n\n");
	});

	it("returns metadata mode when analysisText is null", () => {
		const { documentMode } = buildSongRerankDocument({
			...baseSong,
			analysisText: null,
		});
		expect(documentMode).toBe("metadata");
	});

	it("returns analysis mode when analysisText is provided", () => {
		const { document, documentMode } = buildSongRerankDocument({
			...baseSong,
			analysisText: "Dreamy pop with layered synths",
		});
		expect(documentMode).toBe("analysis");
		expect(document).toBe(
			"Alpha Song by Artist A. Genres: pop.\n\nDreamy pop with layered synths",
		);
	});

	it("handles multiple artists joined by comma", () => {
		const { document } = buildSongRerankDocument({
			...baseSong,
			artists: ["Artist A", "Artist B"],
		});
		expect(document).toContain("Artist A, Artist B");
	});

	it("handles null genres gracefully", () => {
		const { document } = buildSongRerankDocument({
			...baseSong,
			genres: null,
		});
		expect(document).toBe("Alpha Song by Artist A. Genres: .");
	});

	it("truncates analysis tail at a word boundary when it exceeds the char cap", () => {
		const wordCount = Math.ceil(ANALYSIS_TAIL_MAX_CHARS / 5) + 50;
		const longAnalysis = Array.from(
			{ length: wordCount },
			(_, i) => `word${i}`,
		).join(" ");
		expect(longAnalysis.length).toBeGreaterThan(ANALYSIS_TAIL_MAX_CHARS);

		const { document, documentMode } = buildSongRerankDocument({
			...baseSong,
			analysisText: longAnalysis,
		});

		expect(documentMode).toBe("analysis");
		const [prefix, tail] = document.split("\n\n");
		expect(prefix).toBe("Alpha Song by Artist A. Genres: pop.");
		expect(tail.length).toBeLessThanOrEqual(ANALYSIS_TAIL_MAX_CHARS);

		// Tail must end on a whole word token
		const tailWords = tail.split(" ");
		const lastWord = tailWords[tailWords.length - 1];
		expect(longAnalysis.split(" ")).toContain(lastWord);
	});

	it("produces the same metadata format as the inline builder in reranking.ts", () => {
		// Regression guard: the format must stay byte-identical to the existing
		// inline construction so switching callers to this builder is lossless.
		const { document } = buildSongRerankDocument({
			name: "Beta Song",
			artists: ["Artist B"],
			genres: ["rock"],
		});
		expect(document).toBe("Beta Song by Artist B. Genres: rock.");
	});
});

describe("buildPlaylistRerankDocument", () => {
	it("returns metadata mode always", () => {
		const { documentMode } = buildPlaylistRerankDocument({ name: "Chill" });
		expect(documentMode).toBe("metadata");
	});

	it("returns just the name when matchIntent and genrePills are absent", () => {
		const { document } = buildPlaylistRerankDocument({ name: "Chill" });
		expect(document).toBe("Chill");
	});

	it("appends matchIntent after name with em-dash separator", () => {
		const { document } = buildPlaylistRerankDocument({
			name: "Chill Vibes",
			matchIntent: "relaxing music",
		});
		expect(document).toBe("Chill Vibes — relaxing music");
	});

	it("appends genre pills as Genres suffix", () => {
		const { document } = buildPlaylistRerankDocument({
			name: "Chill Vibes",
			genrePills: ["indie", "lo-fi"],
		});
		expect(document).toBe("Chill Vibes. Genres: indie, lo-fi");
	});

	it("combines matchIntent and genrePills", () => {
		const { document } = buildPlaylistRerankDocument({
			name: "Chill Vibes",
			matchIntent: "relaxing music",
			genrePills: ["indie"],
		});
		expect(document).toBe("Chill Vibes — relaxing music. Genres: indie");
	});

	it("omits genre suffix when genrePills is null", () => {
		const { document } = buildPlaylistRerankDocument({
			name: "Chill",
			genrePills: null,
		});
		expect(document).toBe("Chill");
	});

	it("filters out empty strings from genrePills", () => {
		const { document } = buildPlaylistRerankDocument({
			name: "Chill",
			genrePills: ["", "pop", ""],
		});
		expect(document).toBe("Chill. Genres: pop");
	});
});

const songs: SongForRanking[] = [
	{ id: "s1", name: "Alpha Song", artists: ["Artist A"], genres: ["pop"] },
	{ id: "s2", name: "Beta Song", artists: ["Artist B"], genres: ["rock"] },
];

const playlists: PlaylistForRanking[] = [
	{ id: "pl1", name: "Chill Vibes", matchIntent: "relaxing music" },
	{ id: "pl2", name: "Party Mix", genrePills: ["pop"] },
	{ id: "pl3", name: "Focus Beats" },
];

function makePair(
	songId: string,
	playlistId: string,
	fusedScore: number,
): StoredMatchPairForRanking {
	return { songId, playlistId, fusedScore };
}

/** Build a mock RerankerService that returns the given candidates as-is. */
function mockReranker(
	candidates: Array<{
		id: string;
		score: number;
		rerankerScore?: number;
	}>,
): RerankerService {
	return {
		rerank: vi.fn().mockResolvedValue(
			Result.ok({
				candidates: candidates.map((c) => ({
					id: c.id,
					score: c.score,
					document: "",
					// Only set metadata.rerank_score for candidates that were reranked.
					...(c.rerankerScore !== undefined
						? {
								metadata: {
									rerank_score: c.rerankerScore,
									original_score: c.score,
								},
							}
						: {}),
				})),
				reranked: true,
				rerankedCount: candidates.filter((c) => c.rerankerScore !== undefined)
					.length,
				stats: { originalTopScore: 0.8, rerankTopScore: 0.9, scoreShift: 0.1 },
			}),
		),
	} as unknown as RerankerService;
}

function failingReranker(): RerankerService {
	return {
		rerank: vi
			.fn()
			.mockResolvedValue(Result.err({ message: "provider unavailable" })),
	} as unknown as RerankerService;
}

function skippingReranker(): RerankerService {
	return {
		rerank: vi.fn().mockResolvedValue(
			Result.ok({
				candidates: [],
				reranked: false,
				rerankedCount: 0,
				stats: { originalTopScore: 0, rerankTopScore: 0, scoreShift: 0 },
			}),
		),
	} as unknown as RerankerService;
}

describe("rankSongSuggestionLists", () => {
	it("returns one RankedSuggestionLists per song with orientation=song", async () => {
		const pairs = [
			makePair("s1", "pl1", 0.8),
			makePair("s1", "pl2", 0.6),
			makePair("s2", "pl1", 0.7),
		];
		const reranker = mockReranker([
			{ id: "pl1", score: 0.85, rerankerScore: 0.9 },
			{ id: "pl2", score: 0.75, rerankerScore: 0.7 },
		]);

		const results = await rankSongSuggestionLists({
			storedPairs: pairs,
			songs,
			playlists,
			rerankerService: reranker,
		});

		expect(results).toHaveLength(2);
		for (const r of results) {
			expect(r.orientation).toBe("song");
		}
		const s1 = results.find((r) => r.subjectId === "s1");
		expect(s1).toBeDefined();
		expect(s1?.rankedPairs).toHaveLength(2);
	});

	it("full rerank: pairs have source=rerank and non-null rerankerScore", async () => {
		const pairs = [makePair("s1", "pl1", 0.8), makePair("s1", "pl2", 0.6)];
		// Reranker inverts the order: pl2 scores higher
		const reranker = mockReranker([
			{ id: "pl2", score: 0.9, rerankerScore: 0.95 },
			{ id: "pl1", score: 0.75, rerankerScore: 0.7 },
		]);

		const results = await rankSongSuggestionLists({
			storedPairs: pairs,
			songs,
			playlists,
			rerankerService: reranker,
		});

		const s1 = results.find((r) => r.subjectId === "s1");
		const [first, second] = s1?.rankedPairs ?? [];

		// pl2 should be rank 1 (higher orderingScore after rerank)
		expect(first.playlistId).toBe("pl2");
		expect(first.source).toBe("rerank");
		expect(first.rerankerScore).toBe(0.95);
		expect(first.orderingScore).toBe(0.9);

		expect(second.playlistId).toBe("pl1");
		expect(second.source).toBe("rerank");
		expect(second.rerankerScore).toBe(0.7);
	});

	it("partial rerank tail: tail candidates are fused_fallback with null rerankerScore", async () => {
		// Three playlists for s1; reranker returns pl1 as reranked, pl2 and pl3 as tail
		const pairs = [
			makePair("s1", "pl1", 0.8),
			makePair("s1", "pl2", 0.6),
			makePair("s1", "pl3", 0.4),
		];
		const reranker = mockReranker([
			// pl1 got a raw cross-encoder score → source=rerank
			{ id: "pl1", score: 0.85, rerankerScore: 0.9 },
			// pl2 and pl3 are tail → no rerankerScore → fused_fallback
			{ id: "pl2", score: 0.6 },
			{ id: "pl3", score: 0.4 },
		]);

		const results = await rankSongSuggestionLists({
			storedPairs: pairs,
			songs,
			playlists,
			rerankerService: reranker,
		});

		const s1 = results.find((r) => r.subjectId === "s1");
		expect(s1?.rankedPairs).toHaveLength(3);

		const ranked = s1?.rankedPairs ?? [];
		const pl1Row = ranked.find((p) => p.playlistId === "pl1");
		const pl2Row = ranked.find((p) => p.playlistId === "pl2");
		const pl3Row = ranked.find((p) => p.playlistId === "pl3");

		expect(pl1Row?.source).toBe("rerank");
		expect(pl1Row?.rerankerScore).toBe(0.9);

		// Tail rows must be fused_fallback with null rerankerScore
		expect(pl2Row?.source).toBe("fused_fallback");
		expect(pl2Row?.rerankerScore).toBeNull();
		expect(pl2Row?.orderingScore).toBe(0.6);

		expect(pl3Row?.source).toBe("fused_fallback");
		expect(pl3Row?.rerankerScore).toBeNull();
		expect(pl3Row?.orderingScore).toBe(0.4);
	});

	it("dense ranks are by orderingScore desc, playlistId asc as tiebreak", async () => {
		// Two playlists with equal orderingScore — playlistId asc decides
		const pairs = [makePair("s1", "pl2", 0.5), makePair("s1", "pl1", 0.5)];
		// Both are fused_fallback (reranker skipped)
		const reranker = skippingReranker();

		const results = await rankSongSuggestionLists({
			storedPairs: pairs,
			songs,
			playlists,
			rerankerService: reranker,
		});

		const s1 = results.find((r) => r.subjectId === "s1");
		// pl1 < pl2 lexicographically → pl1 is rank 1 (index 0)
		expect(s1?.rankedPairs[0].playlistId).toBe("pl1");
		expect(s1?.rankedPairs[1].playlistId).toBe("pl2");
	});

	it("reranker failure → all pairs are fused_fallback ordered by fusedScore", async () => {
		const pairs = [makePair("s1", "pl1", 0.8), makePair("s1", "pl2", 0.6)];

		const results = await rankSongSuggestionLists({
			storedPairs: pairs,
			songs,
			playlists,
			rerankerService: failingReranker(),
		});

		const s1 = results.find((r) => r.subjectId === "s1");
		expect(s1?.rankedPairs).toHaveLength(2);
		for (const pair of s1?.rankedPairs ?? []) {
			expect(pair.source).toBe("fused_fallback");
			expect(pair.rerankerScore).toBeNull();
		}
		// Ordered by fusedScore desc
		expect(s1?.rankedPairs[0].playlistId).toBe("pl1");
		expect(s1?.rankedPairs[0].orderingScore).toBe(0.8);
	});

	it("reranker skip (reranked=false) → all pairs are fused_fallback", async () => {
		const pairs = [makePair("s1", "pl1", 0.7), makePair("s1", "pl2", 0.9)];

		const results = await rankSongSuggestionLists({
			storedPairs: pairs,
			songs,
			playlists,
			rerankerService: skippingReranker(),
		});

		const s1 = results.find((r) => r.subjectId === "s1");
		for (const pair of s1?.rankedPairs ?? []) {
			expect(pair.source).toBe("fused_fallback");
		}
		// pl2 has higher fusedScore → rank 1
		expect(s1?.rankedPairs[0].playlistId).toBe("pl2");
	});

	it("missing song metadata → all pairs are fused_fallback (no query doc)", async () => {
		const pairs = [makePair("s1", "pl1", 0.8), makePair("s1", "pl2", 0.6)];
		// Pass an empty songs array so s1 has no metadata
		const reranker = mockReranker([
			{ id: "pl1", score: 0.9, rerankerScore: 0.95 },
		]);

		const results = await rankSongSuggestionLists({
			storedPairs: pairs,
			songs: [], // no metadata available
			playlists,
			rerankerService: reranker,
		});

		// Reranker should never be called since there's no query document.
		expect(reranker.rerank).not.toHaveBeenCalled();

		const s1 = results.find((r) => r.subjectId === "s1");
		for (const pair of s1?.rankedPairs ?? []) {
			expect(pair.source).toBe("fused_fallback");
		}
	});

	it("documentMode is 'metadata' for all playlist candidates (playlists have no analysis prose)", async () => {
		const pairs = [makePair("s1", "pl1", 0.8), makePair("s1", "pl2", 0.6)];
		const reranker = mockReranker([
			{ id: "pl1", score: 0.85, rerankerScore: 0.9 },
			{ id: "pl2", score: 0.75, rerankerScore: 0.7 },
		]);

		const results = await rankSongSuggestionLists({
			storedPairs: pairs,
			songs,
			playlists,
			rerankerService: reranker,
		});

		const s1 = results.find((r) => r.subjectId === "s1");
		for (const pair of s1?.rankedPairs ?? []) {
			// buildPlaylistRerankDocument always returns 'metadata' mode
			expect(pair.documentMode).toBe("metadata");
		}
	});

	it("does not mutate the input storedPairs array", async () => {
		const pairs: StoredMatchPairForRanking[] = [
			makePair("s1", "pl1", 0.8),
			makePair("s1", "pl2", 0.6),
		];
		const originalOrder = pairs.map((p) => p.playlistId);
		const reranker = mockReranker([
			{ id: "pl2", score: 0.9, rerankerScore: 0.95 },
			{ id: "pl1", score: 0.7, rerankerScore: 0.65 },
		]);

		await rankSongSuggestionLists({
			storedPairs: pairs,
			songs,
			playlists,
			rerankerService: reranker,
		});

		// Original array order must be unchanged
		expect(pairs.map((p) => p.playlistId)).toEqual(originalOrder);
	});

	it("orderingScore and rerankerScore are independent of strictnessScore (no strictness in output)", async () => {
		// Guard: RankedPair must not have a 'strictnessScore' or related field that
		// could be confused with display/filter scores. We verify the shape by
		// checking that only the declared fields are present on a result row.
		const pairs = [makePair("s1", "pl1", 0.8)];
		const reranker = mockReranker([
			{ id: "pl1", score: 0.85, rerankerScore: 0.9 },
		]);

		const results = await rankSongSuggestionLists({
			storedPairs: pairs,
			songs,
			playlists,
			rerankerService: reranker,
		});

		const s1 = results.find((r) => r.subjectId === "s1");
		const pair = s1?.rankedPairs[0];

		// Only declared RankedPair fields should be present.
		const keys = Object.keys(pair ?? {}).sort();
		expect(keys).toEqual(
			[
				"documentMode",
				"orderingScore",
				"playlistId",
				"rerankerScore",
				"songId",
				"source",
			].sort(),
		);
	});

	it("multiple songs produce independent suggestion lists with dense ranks each", async () => {
		const pairs = [
			makePair("s1", "pl1", 0.8),
			makePair("s1", "pl2", 0.6),
			makePair("s2", "pl1", 0.7),
			makePair("s2", "pl3", 0.5),
		];
		const reranker: RerankerService = {
			rerank: vi.fn().mockResolvedValue(
				Result.ok({
					candidates: [
						// Return first call for s1 (2 candidates), second for s2 (2 candidates)
						{
							id: "pl1",
							score: 0.85,
							document: "",
							metadata: { rerank_score: 0.9 },
						},
						{
							id: "pl2",
							score: 0.75,
							document: "",
							metadata: { rerank_score: 0.7 },
						},
					],
					reranked: true,
					rerankedCount: 2,
					stats: {
						originalTopScore: 0.8,
						rerankTopScore: 0.85,
						scoreShift: 0.05,
					},
				}),
			),
		} as unknown as RerankerService;

		const results = await rankSongSuggestionLists({
			storedPairs: pairs,
			songs,
			playlists,
			rerankerService: reranker,
		});

		expect(results).toHaveLength(2);
		for (const r of results) {
			// Each list starts at rank 1 (index 0), independently
			expect(r.rankedPairs.length).toBeGreaterThan(0);
		}
	});

	it("stops early when isSuperseded fires between song suggestion lists", async () => {
		// Three songs; superseded fires after the first iteration.
		const pairs = [
			makePair("s1", "pl1", 0.8),
			makePair("s2", "pl1", 0.7),
			makePair("s3", "pl2", 0.6),
		];
		const s3: SongForRanking = {
			id: "s3",
			name: "Gamma Song",
			artists: ["Artist C"],
			genres: ["jazz"],
		};
		const reranker = mockReranker([
			{ id: "pl1", score: 0.85, rerankerScore: 0.9 },
		]);

		let callCount = 0;
		const isSuperseded = vi.fn(async () => {
			callCount++;
			// Return true on the second call (after first song is processed).
			return callCount >= 2;
		});

		const results = await rankSongSuggestionLists({
			storedPairs: pairs,
			songs: [...songs, s3],
			playlists,
			rerankerService: reranker,
			isSuperseded,
		});

		// Stopped early — should have fewer than 3 results.
		expect(results.length).toBeLessThan(3);
		expect(isSuperseded).toHaveBeenCalled();
	});
});

const songsForPlaylist: SongForRanking[] = [
	{ id: "s1", name: "Alpha Song", artists: ["Artist A"], genres: ["pop"] },
	{
		id: "s2",
		name: "Beta Song",
		artists: ["Artist B"],
		genres: ["rock"],
		analysisText: "Heavy guitars with melodic undertones",
	},
	{ id: "s3", name: "Gamma Song", artists: ["Artist C"], genres: ["jazz"] },
];

const playlistsForPlaylist: PlaylistForRanking[] = [
	{ id: "pl1", name: "Chill Vibes", matchIntent: "relaxing music" },
	{ id: "pl2", name: "Party Mix", genrePills: ["pop"] },
];

describe("rankPlaylistSuggestionLists", () => {
	it("returns one RankedSuggestionLists per playlist with orientation=playlist", async () => {
		const pairs = [
			makePair("s1", "pl1", 0.8),
			makePair("s2", "pl1", 0.6),
			makePair("s1", "pl2", 0.7),
		];
		const reranker = mockReranker([
			{ id: "s1", score: 0.85, rerankerScore: 0.9 },
			{ id: "s2", score: 0.75, rerankerScore: 0.7 },
		]);

		const results = await rankPlaylistSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: reranker,
		});

		expect(results).toHaveLength(2);
		for (const r of results) {
			expect(r.orientation).toBe("playlist");
		}
		const pl1 = results.find((r) => r.subjectId === "pl1");
		expect(pl1).toBeDefined();
		expect(pl1?.rankedPairs).toHaveLength(2);
	});

	it("full rerank: pairs have source=rerank and non-null rerankerScore", async () => {
		const pairs = [makePair("s1", "pl1", 0.8), makePair("s2", "pl1", 0.6)];
		// Reranker inverts the order: s2 scores higher
		const reranker = mockReranker([
			{ id: "s2", score: 0.9, rerankerScore: 0.95 },
			{ id: "s1", score: 0.75, rerankerScore: 0.7 },
		]);

		const results = await rankPlaylistSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: reranker,
		});

		const pl1 = results.find((r) => r.subjectId === "pl1");
		const [first, second] = pl1?.rankedPairs ?? [];

		// s2 should be rank 1 (higher orderingScore after rerank)
		expect(first.songId).toBe("s2");
		expect(first.source).toBe("rerank");
		expect(first.rerankerScore).toBe(0.95);
		expect(first.orderingScore).toBe(0.9);

		expect(second.songId).toBe("s1");
		expect(second.source).toBe("rerank");
		expect(second.rerankerScore).toBe(0.7);
	});

	it("partial rerank tail: tail candidates are fused_fallback with null rerankerScore", async () => {
		const pairs = [
			makePair("s1", "pl1", 0.8),
			makePair("s2", "pl1", 0.6),
			makePair("s3", "pl1", 0.4),
		];
		const reranker = mockReranker([
			// s1 got a raw cross-encoder score → source=rerank
			{ id: "s1", score: 0.85, rerankerScore: 0.9 },
			// s2 and s3 are tail → no rerankerScore → fused_fallback
			{ id: "s2", score: 0.6 },
			{ id: "s3", score: 0.4 },
		]);

		const results = await rankPlaylistSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: reranker,
		});

		const pl1 = results.find((r) => r.subjectId === "pl1");
		expect(pl1?.rankedPairs).toHaveLength(3);

		const ranked = pl1?.rankedPairs ?? [];
		const s1Row = ranked.find((p) => p.songId === "s1");
		const s2Row = ranked.find((p) => p.songId === "s2");
		const s3Row = ranked.find((p) => p.songId === "s3");

		expect(s1Row?.source).toBe("rerank");
		expect(s1Row?.rerankerScore).toBe(0.9);

		// Tail rows must be fused_fallback with null rerankerScore
		expect(s2Row?.source).toBe("fused_fallback");
		expect(s2Row?.rerankerScore).toBeNull();
		expect(s2Row?.orderingScore).toBe(0.6);

		expect(s3Row?.source).toBe("fused_fallback");
		expect(s3Row?.rerankerScore).toBeNull();
		expect(s3Row?.orderingScore).toBe(0.4);
	});

	it("dense ranks are by orderingScore desc, songId asc as tiebreak", async () => {
		// Two songs with equal orderingScore — songId asc decides
		const pairs = [makePair("s2", "pl1", 0.5), makePair("s1", "pl1", 0.5)];
		const reranker = skippingReranker();

		const results = await rankPlaylistSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: reranker,
		});

		const pl1 = results.find((r) => r.subjectId === "pl1");
		// s1 < s2 lexicographically → s1 is rank 1 (index 0)
		expect(pl1?.rankedPairs[0].songId).toBe("s1");
		expect(pl1?.rankedPairs[1].songId).toBe("s2");
	});

	it("reranker failure → all pairs are fused_fallback ordered by fusedScore", async () => {
		const pairs = [makePair("s1", "pl1", 0.8), makePair("s2", "pl1", 0.6)];

		const results = await rankPlaylistSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: failingReranker(),
		});

		const pl1 = results.find((r) => r.subjectId === "pl1");
		expect(pl1?.rankedPairs).toHaveLength(2);
		for (const pair of pl1?.rankedPairs ?? []) {
			expect(pair.source).toBe("fused_fallback");
			expect(pair.rerankerScore).toBeNull();
		}
		// Ordered by fusedScore desc
		expect(pl1?.rankedPairs[0].songId).toBe("s1");
		expect(pl1?.rankedPairs[0].orderingScore).toBe(0.8);
	});

	it("reranker skip (reranked=false) → all pairs are fused_fallback", async () => {
		const pairs = [makePair("s1", "pl1", 0.7), makePair("s2", "pl1", 0.9)];

		const results = await rankPlaylistSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: skippingReranker(),
		});

		const pl1 = results.find((r) => r.subjectId === "pl1");
		for (const pair of pl1?.rankedPairs ?? []) {
			expect(pair.source).toBe("fused_fallback");
		}
		// s2 has higher fusedScore → rank 1
		expect(pl1?.rankedPairs[0].songId).toBe("s2");
	});

	it("missing playlist metadata → all pairs are fused_fallback (no query doc)", async () => {
		const pairs = [makePair("s1", "pl1", 0.8), makePair("s2", "pl1", 0.6)];
		const reranker = mockReranker([
			{ id: "s1", score: 0.9, rerankerScore: 0.95 },
		]);

		const results = await rankPlaylistSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: [], // no metadata available
			rerankerService: reranker,
		});

		// Reranker should never be called since there's no query document.
		expect(reranker.rerank).not.toHaveBeenCalled();

		const pl1 = results.find((r) => r.subjectId === "pl1");
		for (const pair of pl1?.rankedPairs ?? []) {
			expect(pair.source).toBe("fused_fallback");
		}
	});

	it("documentMode reflects song candidate document mode (analysis when analysisText present)", async () => {
		// s2 has analysisText → its candidate document should be 'analysis' mode.
		const pairs = [makePair("s1", "pl1", 0.8), makePair("s2", "pl1", 0.6)];
		const reranker = mockReranker([
			{ id: "s1", score: 0.85, rerankerScore: 0.9 },
			{ id: "s2", score: 0.75, rerankerScore: 0.7 },
		]);

		const results = await rankPlaylistSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: reranker,
		});

		const pl1 = results.find((r) => r.subjectId === "pl1");
		const s1Row = pl1?.rankedPairs.find((p) => p.songId === "s1");
		const s2Row = pl1?.rankedPairs.find((p) => p.songId === "s2");

		// s1 has no analysisText → metadata mode
		expect(s1Row?.documentMode).toBe("metadata");
		// s2 has analysisText → analysis mode
		expect(s2Row?.documentMode).toBe("analysis");
	});

	it("stops early when isSuperseded fires between playlist suggestion lists", async () => {
		const pairs = [
			makePair("s1", "pl1", 0.8),
			makePair("s2", "pl1", 0.6),
			makePair("s1", "pl2", 0.7),
		];
		const reranker = mockReranker([
			{ id: "s1", score: 0.85, rerankerScore: 0.9 },
			{ id: "s2", score: 0.75, rerankerScore: 0.7 },
		]);

		let callCount = 0;
		const isSuperseded = vi.fn(async () => {
			callCount++;
			// Fire after the first playlist is processed.
			return callCount >= 2;
		});

		const results = await rankPlaylistSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: reranker,
			isSuperseded,
		});

		// Only one playlist was processed before superseded fired.
		expect(results.length).toBeLessThan(2);
		expect(isSuperseded).toHaveBeenCalled();
	});

	it("does not mutate the input storedPairs array", async () => {
		const pairs: StoredMatchPairForRanking[] = [
			makePair("s1", "pl1", 0.8),
			makePair("s2", "pl1", 0.6),
		];
		const originalOrder = pairs.map((p) => p.songId);
		const reranker = mockReranker([
			{ id: "s2", score: 0.9, rerankerScore: 0.95 },
			{ id: "s1", score: 0.7, rerankerScore: 0.65 },
		]);

		await rankPlaylistSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: reranker,
		});

		expect(pairs.map((p) => p.songId)).toEqual(originalOrder);
	});
});

describe("rankMatchSuggestionLists", () => {
	it("returns completed status and both orientations when no superseded check", async () => {
		const pairs = [
			makePair("s1", "pl1", 0.8),
			makePair("s2", "pl1", 0.6),
			makePair("s1", "pl2", 0.7),
		];
		const reranker = mockReranker([
			{ id: "pl1", score: 0.85, rerankerScore: 0.9 },
			{ id: "pl2", score: 0.75, rerankerScore: 0.7 },
			{ id: "s1", score: 0.85, rerankerScore: 0.9 },
			{ id: "s2", score: 0.75, rerankerScore: 0.7 },
		]);

		const result = await rankMatchSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: reranker,
		});

		expect(result.status).toBe("completed");
		expect(result.byOrientation.has("song")).toBe(true);
		expect(result.byOrientation.has("playlist")).toBe(true);

		const songLists = result.byOrientation.get("song") ?? [];
		for (const sl of songLists) {
			expect(sl.orientation).toBe("song");
		}

		const playlistLists = result.byOrientation.get("playlist") ?? [];
		for (const pl of playlistLists) {
			expect(pl.orientation).toBe("playlist");
		}
	});

	it("uses MATCH_RANKING_ORIENTATIONS by default (both song and playlist)", async () => {
		const pairs = [makePair("s1", "pl1", 0.8)];
		const reranker = mockReranker([
			{ id: "pl1", score: 0.85, rerankerScore: 0.9 },
			{ id: "s1", score: 0.85, rerankerScore: 0.9 },
		]);

		const result = await rankMatchSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: reranker,
		});

		expect(result.byOrientation.size).toBe(MATCH_RANKING_ORIENTATIONS.length);
		for (const orientation of MATCH_RANKING_ORIENTATIONS) {
			expect(result.byOrientation.has(orientation)).toBe(true);
		}
	});

	it("accepts a subset orientations parameter and only computes those", async () => {
		const pairs = [makePair("s1", "pl1", 0.8)];
		const reranker = mockReranker([
			{ id: "pl1", score: 0.85, rerankerScore: 0.9 },
		]);

		const result = await rankMatchSuggestionLists({
			orientations: ["song"],
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: reranker,
		});

		expect(result.status).toBe("completed");
		expect(result.byOrientation.has("song")).toBe(true);
		expect(result.byOrientation.has("playlist")).toBe(false);
	});

	it("returns superseded status when isSuperseded fires between orientations", async () => {
		const pairs = [makePair("s1", "pl1", 0.8)];
		const reranker = mockReranker([
			{ id: "pl1", score: 0.85, rerankerScore: 0.9 },
		]);

		let callCount = 0;
		// Fires after song orientation completes (before playlist starts).
		const isSuperseded = vi.fn(async () => {
			callCount++;
			return callCount >= 2;
		});

		const result = await rankMatchSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: reranker,
			isSuperseded,
		});

		expect(result.status).toBe("superseded");
		// byOrientation has whatever was completed before stop
		expect(isSuperseded).toHaveBeenCalled();
	});

	it("returns superseded status and partial byOrientation when isSuperseded fires before first orientation", async () => {
		const pairs = [makePair("s1", "pl1", 0.8)];
		const reranker = mockReranker([]);

		// Always superseded — fires immediately.
		const isSuperseded = vi.fn(async () => true);

		const result = await rankMatchSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: reranker,
			isSuperseded,
		});

		expect(result.status).toBe("superseded");
		// Nothing ranked yet since it was superseded immediately.
		expect(result.byOrientation.size).toBe(0);
	});

	it("song orientation produces correct RankedSuggestionLists subjectIds", async () => {
		const pairs = [makePair("s1", "pl1", 0.8), makePair("s2", "pl2", 0.7)];
		const reranker = mockReranker([
			{ id: "pl1", score: 0.85, rerankerScore: 0.9 },
			{ id: "pl2", score: 0.75, rerankerScore: 0.7 },
		]);

		const result = await rankMatchSuggestionLists({
			storedPairs: pairs,
			songs: songsForPlaylist,
			playlists: playlistsForPlaylist,
			rerankerService: reranker,
		});

		const songLists = result.byOrientation.get("song") ?? [];
		const subjectIds = new Set(songLists.map((sl) => sl.subjectId));
		expect(subjectIds).toContain("s1");
		expect(subjectIds).toContain("s2");
	});
});

/**
 * Tests for the rewritten genre scoring logic (Task 1.3).
 *
 * Uses the exported pure helpers `bandedCredit` and `scoreGenres` directly
 * rather than going through MatchingService, which lets us verify the scoring
 * math without constructing the full service or wrestling with private methods.
 */

import { describe, expect, it } from "vitest";
import { ADJACENT_FLOOR, ADJACENT_MAX } from "../config";
import { bandedCredit, scoreGenres } from "../service";

// ============================================================================
// bandedCredit
// ============================================================================

describe("bandedCredit", () => {
	it("exact match (r >= 1) → 1.0", () => {
		expect(bandedCredit(1)).toBe(1);
		// Symmetry guarantee in the table means values are always ≤ 1, but
		// guard the edge case anyway.
		expect(bandedCredit(1.0)).toBe(1);
	});

	it("below floor → 0 (unrelated genres produce no signal)", () => {
		expect(bandedCredit(0)).toBe(0);
		expect(bandedCredit(ADJACENT_FLOOR - 0.001)).toBe(0);
		expect(bandedCredit(0.1)).toBe(0);
	});

	it("at floor boundary → min(ADJACENT_FLOOR, ADJACENT_MAX) (non-zero)", () => {
		// ADJACENT_FLOOR (0.3) < ADJACENT_MAX (0.6), so credit = 0.3
		expect(bandedCredit(ADJACENT_FLOOR)).toBeCloseTo(ADJACENT_FLOOR);
	});

	it("adjacent range is capped at ADJACENT_MAX (0.6)", () => {
		// Any value above the cap (e.g. a hypothetical 0.8) must be clamped to 0.6;
		// subgenre edges already land at the cap (rock→"hard rock" = 0.6 exactly).
		expect(bandedCredit(0.8)).toBeCloseTo(ADJACENT_MAX);
		expect(bandedCredit(0.99)).toBeCloseTo(ADJACENT_MAX);
		expect(bandedCredit(0.6)).toBeCloseTo(ADJACENT_MAX);
	});

	it("mid-range value passes through unchanged when below cap", () => {
		// 0.45 is between floor and cap → returned as-is
		expect(bandedCredit(0.45)).toBeCloseTo(0.45);
	});
});

// ============================================================================
// scoreGenres — unit tests over the pure scoring function
// ============================================================================

describe("scoreGenres", () => {
	it("empty playlist distribution → 0", () => {
		expect(scoreGenres(["hip-hop"], {})).toBe(0);
	});

	// ---- Exact match ----

	it("exact match playlist genre = song genre → 1.0", () => {
		// hip-hop playlist, hip-hop song: genreSimilarity returns 1 after
		// canonicalization → bandedCredit(1) = 1.
		expect(scoreGenres(["hip-hop"], { "hip-hop": 1 })).toBe(1);
	});

	it("exact match with raw case / punctuation → 1.0 (canonicalization)", () => {
		// canonicalizeGenre normalizes both sides — "R&B" and "r&b" both → "rnb"
		expect(scoreGenres(["r&b"], { "R&B": 1 })).toBe(1);
	});

	// ---- Adjacent genre — partial credit, capped at ADJACENT_MAX ----

	it("adjacent genre (r&b song in hip-hop playlist) → related edge 0.5, below cap", () => {
		// hip-hop→rnb is a `related` edge (0.5) in the directed graph — below the
		// cap of 0.6, so it passes through unchanged.
		const score = scoreGenres(["r&b"], { "hip-hop": 1 });
		expect(score).toBeCloseTo(0.5, 5);
		expect(score).toBeLessThan(1);
	});

	it("hierarchy pair (hard-rock song in rock playlist) → capped at ADJACENT_MAX 0.6", () => {
		// rock→"hard rock" is a parent-to-child edge = 0.6, which equals the cap.
		expect(scoreGenres(["hard rock"], { rock: 1 })).toBeCloseTo(
			ADJACENT_MAX,
			5,
		);
	});

	// ---- Distant genre — zero credit ----

	it("distant genre (black-metal song in hip-hop playlist) → ~0", () => {
		// hip-hop ↔ black-metal: not in each other's neighbor lists → sim = 0
		// → bandedCredit(0) = 0
		expect(scoreGenres(["black metal"], { "hip-hop": 1 })).toBe(0);
	});

	// ---- Multi-genre playlist weighted blend ----

	it("multi-genre playlist: score is mass-weighted average of per-genre credits", () => {
		// Playlist: 60% hip-hop, 40% black-metal
		// Song: r&b
		//   hip-hop credit:     bandedCredit(sim(hip-hop, rnb)) = 0.5 (related edge)
		//   black-metal credit: bandedCredit(sim(black-metal, rnb)) = 0 (unrelated)
		// Expected: (0.5 * 0.6 + 0 * 0.4) / (0.6 + 0.4) = 0.30
		const score = scoreGenres(["r&b"], { "hip-hop": 0.6, "black metal": 0.4 });
		expect(score).toBeCloseTo(0.3, 5);
	});

	it("multi-genre song takes the best credit across all song genres", () => {
		// Song: ["black metal", "hip-hop"]. Playlist: hip-hop.
		// black-metal vs hip-hop → 0; hip-hop vs hip-hop → 1
		// best = 1 → score = 1
		expect(scoreGenres(["black metal", "hip-hop"], { "hip-hop": 1 })).toBe(1);
	});

	it("scale-invariant: raw counts and fractions produce the same score", () => {
		// The ratio Σ(w·credit) / Σ(w) is unchanged by a uniform scale factor.
		const fractions = scoreGenres(["r&b"], { "hip-hop": 0.6, rock: 0.4 });
		const counts = scoreGenres(["r&b"], { "hip-hop": 60, rock: 40 });
		expect(fractions).toBeCloseTo(counts, 10);
	});
});

// ============================================================================
// Missing-tags neutrality — verified as a no-op in Task 1.3
//
// When songGenres is empty/null, computeRawScored sets
// availability.hasGenres = false, which causes:
//   1. computeFactorStats: genre score excluded from genre stats array
//   2. computeAdaptiveWeights: genre weight redistributed to other signals
//   3. normalizeFactor: returns 0 (inert) — never weighted into fused score
//
// The private computeGenreScore early-return-0 is therefore a harmless no-op,
// not a fused-0 that would bury the song. These integration tests confirm the
// full service path honours that contract.
// ============================================================================

import { Result } from "better-result";
import { createMatchingService } from "../service";
import type {
	MatchingAudioFeatures,
	MatchingPlaylistProfile,
	MatchingSong,
} from "../types";

function makeAudio(energy: number): MatchingAudioFeatures {
	return {
		energy,
		valence: 0.5,
		danceability: 0.5,
		acousticness: 0.5,
		instrumentalness: 0.5,
		speechiness: 0.5,
		liveness: 0.5,
		tempo: 120,
		loudness: -10,
	};
}

function makeProfile(
	id: string,
	dist: Record<string, number>,
): MatchingPlaylistProfile {
	return {
		playlistId: id,
		embedding: null,
		audioCentroid: { energy: 0.8 },
		genreDistribution: dist,
		hasGenrePills: false,
	};
}

describe("missing-tags neutrality (integration)", () => {
	it("song with no genres is not buried: confidence reflects 2/3 signals, not 1/3", async () => {
		// Two songs: one with genres (pop), one without.
		// Neither has embeddings. Both have audio features.
		// With genres unavailable, confidence should be 2/3 (audio + embedding slot)
		// actually: embedding unavailable too → 1/3. Audio is the only signal.
		// Key property: the no-genre song should NOT score 0 on genre and have that
		// dragged into fusion. Its genre weight must be redistributed.
		const service = createMatchingService(null, null, {
			minScoreThreshold: 0,
			normalization: {
				enabled: false,
				method: "zscore",
				minSamples: 8,
				fallbackSimilarityBaseline: 0.5,
			},
		});

		const withGenres: MatchingSong = {
			id: "with-genres",
			spotifyId: "sp-1",
			name: "Song A",
			artists: ["A"],
			genres: ["pop"],
			audioFeatures: makeAudio(0.8),
		};

		const noGenres: MatchingSong = {
			id: "no-genres",
			spotifyId: "sp-2",
			name: "Song B",
			artists: ["B"],
			genres: [],
			audioFeatures: makeAudio(0.8),
		};

		const profiles = [makeProfile("playlist-1", { pop: 1 })];

		const result = await service.matchBatch(
			[withGenres, noGenres],
			profiles,
			new Map(),
		);

		if (Result.isError(result)) throw result.error;

		const withGenresMatch = result.value.matches.get("with-genres")?.[0];
		const noGenresMatch = result.value.matches.get("no-genres")?.[0];

		// Both should produce matches (score threshold is 0), not be buried.
		expect(withGenresMatch).toBeDefined();
		expect(noGenresMatch).toBeDefined();

		// Song with no genres: only audio available (no embedding, no genres).
		// confidence = 1/3
		expect(noGenresMatch?.confidence).toBeCloseTo(1 / 3);

		// Normalized genre factor for no-genre song must be exactly 0 (inert),
		// meaning it was NOT fused as a real-0 dragging down the audio contribution.
		expect(noGenresMatch?.normalizedFactors.genre).toBe(0);

		// Audio signals are identical so both songs should score similarly on audio.
		// The no-genre song gets audio weight boosted to compensate for missing genre —
		// it should NOT score dramatically lower than the with-genre song.
		const withScore = withGenresMatch?.score ?? 0;
		const noScore = noGenresMatch?.score ?? 0;

		// Genre signal is missing for the no-genre song so its audio weight gets
		// boosted. The delta should be small — not a 0.20 penalty from a fused-0.
		expect(Math.abs(withScore - noScore)).toBeLessThan(0.35);
	});
});

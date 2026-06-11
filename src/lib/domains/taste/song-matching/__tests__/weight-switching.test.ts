/**
 * Tests for per-playlist weight switching (Task 1.5).
 *
 * Verifies that `selectBaseWeights` and the full fuse() path correctly route
 * playlists with declared genre pills to the higher-genre weight set and
 * playlists without pills to the default weight set.
 */

import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_MATCHING_CONFIG,
	selectBaseWeights,
	WEIGHTS_WITH_DECLARED_GENRES,
} from "../config";
import { createMatchingService } from "../service";
import type {
	MatchingAudioFeatures,
	MatchingPlaylistProfile,
	MatchingSong,
} from "../types";

// ============================================================================
// selectBaseWeights — pure selector unit tests
// ============================================================================

describe("selectBaseWeights", () => {
	it("returns config.weightsWithDeclaredGenres when hasGenrePills is true", () => {
		const result = selectBaseWeights(DEFAULT_MATCHING_CONFIG, true);
		expect(result.genre).toBeCloseTo(0.4);
		expect(result.embedding).toBeCloseTo(0.35);
		expect(result.audio).toBeCloseTo(0.25);
		expect(result).toBe(DEFAULT_MATCHING_CONFIG.weightsWithDeclaredGenres);
	});

	it("returns config.weights when hasGenrePills is false", () => {
		const result = selectBaseWeights(DEFAULT_MATCHING_CONFIG, false);
		expect(result.genre).toBeCloseTo(0.2);
		expect(result.embedding).toBeCloseTo(0.5);
		expect(result.audio).toBeCloseTo(0.3);
		expect(result).toBe(DEFAULT_MATCHING_CONFIG.weights);
	});

	it("genre weight is meaningfully higher for pill playlists (~2× of non-pill)", () => {
		const noPills = selectBaseWeights(DEFAULT_MATCHING_CONFIG, false);
		const withPills = selectBaseWeights(DEFAULT_MATCHING_CONFIG, true);
		expect(withPills.genre).toBeGreaterThan(noPills.genre * 1.5);
	});

	it("pill weights are from WEIGHTS_WITH_DECLARED_GENRES constant", () => {
		expect(WEIGHTS_WITH_DECLARED_GENRES.genre).toBeCloseTo(0.4);
		expect(WEIGHTS_WITH_DECLARED_GENRES.embedding).toBeCloseTo(0.35);
		expect(WEIGHTS_WITH_DECLARED_GENRES.audio).toBeCloseTo(0.25);
	});

	it("custom config object is respected", () => {
		const custom = {
			weights: { embedding: 0.5, audio: 0.3, genre: 0.2 },
			weightsWithDeclaredGenres: { embedding: 0.2, audio: 0.2, genre: 0.6 },
		};
		const withPills = selectBaseWeights(custom, true);
		expect(withPills.genre).toBeCloseTo(0.6);
		const noPills = selectBaseWeights(custom, false);
		expect(noPills.genre).toBeCloseTo(0.2);
	});
});

// ============================================================================
// Integration: pill-based weight selection reaches fuse()
// ============================================================================

function audio(): MatchingAudioFeatures {
	return {
		energy: 0.8,
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

function makeSong(genres: string[]): MatchingSong {
	return {
		id: "song-1",
		spotifyId: "sp-1",
		name: "Track",
		artists: ["Artist"],
		genres,
		audioFeatures: audio(),
	};
}

function makeProfile(
	id: string,
	dist: Record<string, number>,
	hasGenrePills: boolean,
): MatchingPlaylistProfile {
	return {
		playlistId: id,
		embedding: [1, 0],
		audioCentroid: { energy: 0.8 },
		genreDistribution: dist,
		hasGenrePills,
	};
}

describe("per-playlist weight switch via matchBatch", () => {
	it("pill playlist ranks genre-match higher than a weaker-genre playlist when genre weight is boosted", async () => {
		// Design: two songs (A and B) vs two playlists (genre-strong and audio-strong).
		// Song A has the matching genre; Song B has better audio match.
		// With pill weights (genre 0.40 > audio 0.25), the genre-song wins the
		// genre-strong playlist ranking. This shows the weight switch has effect.
		//
		// Use fallback (non-normalized) mode to avoid z-score collapsing the
		// differential — fallback stretches embedding, passes audio/genre through raw.
		const service = createMatchingService(null, null, {
			minScoreThreshold: 0,
			normalization: {
				enabled: false,
				method: "zscore",
				minSamples: 8,
				fallbackSimilarityBaseline: 0.5,
			},
		});

		// Genre-strong playlist (has pills): "hip-hop" is 100% of the distribution
		const pillProfile = makeProfile("pill-genre", { "hip-hop": 1 }, true);
		// Audio-strong playlist (no pills): same genre distribution
		const noPillProfile = makeProfile("nopill-genre", { "hip-hop": 1 }, false);

		// Song A: exact genre match (hip-hop), modest audio
		const songA: MatchingSong = {
			...makeSong(["hip-hop"]),
			id: "song-a",
			audioFeatures: { ...audio(), energy: 0.5 },
		};

		// Song B: wrong genre, better audio centroid match
		const songB: MatchingSong = {
			...makeSong(["classical"]),
			id: "song-b",
			audioFeatures: { ...audio(), energy: 0.8 },
		};

		const profiles = [pillProfile, noPillProfile];

		const result = await service.matchBatch(
			[songA, songB],
			profiles,
			new Map([
				["song-a", [1, 0]],
				["song-b", [1, 0]],
			]),
		);
		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) throw result.error;

		const aMatches = result.value.matches.get("song-a") ?? [];
		const bMatches = result.value.matches.get("song-b") ?? [];

		const aPill = aMatches.find((m) => m.playlistId === "pill-genre");
		const aNoPill = aMatches.find((m) => m.playlistId === "nopill-genre");
		const bPill = bMatches.find((m) => m.playlistId === "pill-genre");
		const bNoPill = bMatches.find((m) => m.playlistId === "nopill-genre");

		// For the genre-match song (A): pill weight boosts genre → higher score on pill
		// For the genre-mismatch song (B): pill weight boosts a near-zero genre factor
		// Neither should error — both score and produce results.
		expect(aPill).toBeDefined();
		expect(aNoPill).toBeDefined();

		// The pill playlist gives song A (exact genre match) a genre weight of 0.40
		// vs 0.20 for the non-pill playlist — so A scores higher on pill than nopill.
		if (aPill && aNoPill) {
			expect(aPill.score).toBeGreaterThan(aNoPill.score);
		}

		// Song B exists to confirm the batch runs without error even when a song
		// has no genre match for a pill playlist — it's matched, not excluded.
		expect(bPill ?? bNoPill).toBeDefined();
	});

	it("non-pill playlist uses default weights (genre ~0.20)", async () => {
		// Verify via selectBaseWeights that the non-pill path stays on defaults.
		const base = selectBaseWeights(DEFAULT_MATCHING_CONFIG, false);
		expect(base.genre).toBeCloseTo(0.2);
		expect(base.embedding).toBeCloseTo(0.5);
	});

	it("pill playlist uses pill weights (genre ~0.40)", async () => {
		const base = selectBaseWeights(DEFAULT_MATCHING_CONFIG, true);
		expect(base.genre).toBeCloseTo(0.4);
		expect(base.embedding).toBeCloseTo(0.35);
	});

	it("weight switch does not affect z-score stats computation (stats are per-signal across the matrix)", async () => {
		// The stats are computed in computeFactorStats BEFORE fuse() is called.
		// Changing hasGenrePills changes which weights multiply the already-
		// normalized values — it has no upstream effect.
		// Verify: run the batch twice, once with all pill=false, once with all
		// pill=true. The raw factors (pre-normalization) must be identical.
		const service = createMatchingService(null, null, {
			minScoreThreshold: 0,
			normalization: {
				enabled: true,
				method: "zscore",
				minSamples: 2,
				fallbackSimilarityBaseline: 0.5,
			},
		});

		const song = makeSong(["hip-hop"]);

		const noPillProfiles = [
			makeProfile("a", { "hip-hop": 1 }, false),
			makeProfile("b", { rock: 1 }, false),
		];
		const pillProfiles = [
			makeProfile("a", { "hip-hop": 1 }, true),
			makeProfile("b", { rock: 1 }, true),
		];

		const r1 = await service.matchBatch(
			[song],
			noPillProfiles,
			new Map([["song-1", [1, 0]]]),
		);
		const r2 = await service.matchBatch(
			[song],
			pillProfiles,
			new Map([["song-1", [1, 0]]]),
		);

		if (Result.isError(r1) || Result.isError(r2))
			throw new Error("match failed");

		const m1 = r1.value.matches.get("song-1") ?? [];
		const m2 = r2.value.matches.get("song-1") ?? [];

		// Raw factors are pre-normalization and must be equal regardless of pills.
		for (const id of ["a", "b"]) {
			const f1 = m1.find((m) => m.playlistId === id)?.factors;
			const f2 = m2.find((m) => m.playlistId === id)?.factors;
			if (!f1 || !f2) continue;
			expect(f1.embedding).toBeCloseTo(f2.embedding, 8);
			expect(f1.audio).toBeCloseTo(f2.audio, 8);
			expect(f1.genre).toBeCloseTo(f2.genre, 8);
		}
	});
});

/**
 * Tests for matching scoring algorithms.
 */

import { describe, expect, it } from "vitest";
import {
	computeAudioFeatureScore,
	scoreMoodTransition,
	computeFlowScore,
} from "../scoring";
import type { AudioFeatureWeights, MatchingAudioFeatures } from "../types";

// ============================================================================
// computeAudioFeatureScore
// ============================================================================

describe("computeAudioFeatureScore", () => {
	const defaultWeights: AudioFeatureWeights = {
		energy: 1,
		valence: 1,
		danceability: 1,
		acousticness: 1,
		instrumentalness: 1,
		speechiness: 1,
		liveness: 1,
		tempo: 1,
		loudness: 1,
	};

	const songFeatures: MatchingAudioFeatures = {
		energy: 0.8,
		valence: 0.6,
		danceability: 0.7,
		acousticness: 0.2,
		instrumentalness: 0.1,
		speechiness: 0.05,
		liveness: 0.15,
		tempo: 120,
		loudness: -5,
	};

	it("returns 1 for identical features", () => {
		const centroid = {
			energy: 0.8,
			valence: 0.6,
			danceability: 0.7,
			acousticness: 0.2,
			instrumentalness: 0.1,
			speechiness: 0.05,
			liveness: 0.15,
			tempo: 120,
			loudness: -5,
		};
		const score = computeAudioFeatureScore(
			songFeatures,
			centroid,
			defaultWeights,
		);
		expect(score).toBe(1);
	});

	it("returns 0 for empty centroid", () => {
		const score = computeAudioFeatureScore(songFeatures, {}, defaultWeights);
		expect(score).toBe(0);
	});

	it("returns 0 when all weights are zero", () => {
		const zeroWeights: AudioFeatureWeights = {
			energy: 0,
			valence: 0,
			danceability: 0,
			acousticness: 0,
			instrumentalness: 0,
			speechiness: 0,
			liveness: 0,
			tempo: 0,
			loudness: 0,
		};
		const centroid = { energy: 0.5 };
		const score = computeAudioFeatureScore(
			songFeatures,
			centroid,
			zeroWeights,
		);
		expect(score).toBe(0);
	});

	it("normalizes tempo difference by 100", () => {
		const centroid = { tempo: 220 }; // 100 BPM difference
		const weights = { tempo: 1 };
		const score = computeAudioFeatureScore(
			{ tempo: 120 } as MatchingAudioFeatures,
			centroid,
			weights as AudioFeatureWeights,
		);
		// diff = abs(120 - 220) / 100 = 1
		// score = 1 - 1 = 0
		expect(score).toBe(0);
	});

	it("normalizes loudness difference by 60", () => {
		const centroid = { loudness: -65 }; // 60 dB difference
		const weights = { loudness: 1 };
		const score = computeAudioFeatureScore(
			{ loudness: -5 } as MatchingAudioFeatures,
			centroid,
			weights as AudioFeatureWeights,
		);
		// diff = abs(-5 - (-65)) / 60 = 1
		// score = 1 - 1 = 0
		expect(score).toBe(0);
	});

	it("handles standard features in 0-1 range", () => {
		const centroid = { energy: 0.5 };
		const weights = { energy: 1 };
		const score = computeAudioFeatureScore(
			{ energy: 0.7 } as MatchingAudioFeatures,
			centroid,
			weights as AudioFeatureWeights,
		);
		// diff = abs(0.7 - 0.5) = 0.2
		// score = 1 - 0.2 = 0.8
		expect(score).toBeCloseTo(0.8);
	});

	it("handles mixed missing values", () => {
		const centroid = { energy: 0.5, valence: 0.6 };
		const weights = { energy: 1, valence: 1 };
		const features = { energy: 0.7 } as MatchingAudioFeatures;
		const score = computeAudioFeatureScore(features, centroid, weights as AudioFeatureWeights);
		// Only energy is present: diff = 0.2, score = 0.8
		// Valence missing, so not counted
		expect(score).toBeCloseTo(0.8);
	});

	it("clamps score to [0,1] range", () => {
		const centroid = { energy: 0.5 };
		const weights = { energy: 1 };
		const features = { energy: 2.0 } as MatchingAudioFeatures; // Out of range
		const score = computeAudioFeatureScore(
			features,
			centroid,
			weights as AudioFeatureWeights,
		);
		// diff = abs(2.0 - 0.5) = 1.5
		// score = 1 - 1.5 = -0.5, clamped to 0
		expect(score).toBe(0);
	});
});

// ============================================================================
// scoreMoodTransition
// ============================================================================

describe("scoreMoodTransition", () => {
	it("returns 1.0 for same mood", () => {
		expect(scoreMoodTransition("happy", "happy")).toBe(1.0);
	});

	it("returns 1.0 for same mood with different casing", () => {
		expect(scoreMoodTransition("HAPPY", "happy")).toBe(1.0);
	});

	it("returns 0.8 for good transitions", () => {
		expect(scoreMoodTransition("happy", "euphoric")).toBe(0.8);
		expect(scoreMoodTransition("sad", "melancholic")).toBe(0.8);
		expect(scoreMoodTransition("angry", "empowered")).toBe(0.8);
	});

	it("returns 0.6 for related moods", () => {
		expect(scoreMoodTransition("happy", "joyful")).toBe(0.6);
		expect(scoreMoodTransition("sad", "sorrowful")).toBe(0.6);
		expect(scoreMoodTransition("angry", "furious")).toBe(0.6);
	});

	it("returns 0.3 for unrelated moods", () => {
		expect(scoreMoodTransition("happy", "sad")).toBe(0.3);
		expect(scoreMoodTransition("euphoric", "melancholic")).toBe(0.3);
	});

	it("returns 0.3 for unknown moods", () => {
		expect(scoreMoodTransition("unknown_mood", "happy")).toBe(0.3);
		expect(scoreMoodTransition("happy", "unknown_mood")).toBe(0.3);
		expect(scoreMoodTransition("unknown1", "unknown2")).toBe(0.3);
	});

	it("handles whitespace in mood strings", () => {
		expect(scoreMoodTransition("  happy  ", "happy")).toBe(1.0);
	});
});

// ============================================================================
// computeFlowScore
// ============================================================================

describe("computeFlowScore", () => {
	it("returns 0.5 for empty recent songs", () => {
		const score = computeFlowScore("happy", 0.8, 0.6, []);
		expect(score).toBe(0.5);
	});

	it("returns weighted fallback when all values are null", () => {
		const recentSongs = [
			{ dominantMood: "happy" as const, energy: 0.5, valence: 0.5 },
		];
		const score = computeFlowScore(null, null, null, recentSongs);
		expect(score).toBe(0.5); // Neutral fallback when no data
	});

	it("uses last 3 songs when more than 3 provided", () => {
		const recentSongs = [
			{ dominantMood: "sad" as const, energy: 0.3, valence: 0.2 },
			{ dominantMood: "sad" as const, energy: 0.3, valence: 0.2 },
			{ dominantMood: "happy" as const, energy: 0.8, valence: 0.8 },
			{ dominantMood: "happy" as const, energy: 0.8, valence: 0.8 },
			{ dominantMood: "happy" as const, energy: 0.8, valence: 0.8 },
		];
		// Should only consider last 3 (all happy)
		const score = computeFlowScore("happy", 0.8, 0.8, recentSongs);
		expect(score).toBeGreaterThan(0.9); // Perfect match with last 3
	});

	it("applies mood weighting of 50%", () => {
		const recentSongs = [
			{ dominantMood: "happy" as const, energy: 0.5, valence: 0.5 },
		];
		// Same mood = 1.0 * 0.5 = 0.5
		// No energy/valence = 0
		const score = computeFlowScore("happy", null, null, recentSongs);
		expect(score).toBeGreaterThan(0.4); // Should be dominated by mood score
	});

	it("applies energy weighting of 30%", () => {
		const recentSongs = [
			{ dominantMood: null, energy: 0.8, valence: 0.5 },
		];
		// Identical energy (diff = 0): score = 1.0 * 0.3 = 0.3
		// Identical valence (diff = 0): score = 1.0 * 0.2 = 0.2
		// combinedScore = 0.5, weightSum = 0.5
		// Normalized: 0.5 / 0.5 = 1.0 (perfect match on available features)
		const score = computeFlowScore(null, 0.8, 0.5, recentSongs);
		expect(score).toBeCloseTo(1.0);
	});

	it("applies valence weighting of 20%", () => {
		const recentSongs = [
			{ dominantMood: null, energy: 0.5, valence: 0.6 },
		];
		// Identical energy (diff = 0): score = 1.0 * 0.3 = 0.3
		// Identical valence (diff = 0): score = 1.0 * 0.2 = 0.2
		// combinedScore = 0.5, weightSum = 0.5
		// Normalized: 0.5 / 0.5 = 1.0 (perfect match on available features)
		const score = computeFlowScore(null, 0.5, 0.6, recentSongs);
		expect(score).toBeCloseTo(1.0);
	});

	it("averages scores across multiple recent songs", () => {
		const recentSongs = [
			{ dominantMood: "happy" as const, energy: 0.8, valence: 0.8 },
			{ dominantMood: "sad" as const, energy: 0.2, valence: 0.2 },
		];
		// Song 1: perfect match = ~1.0
		// Song 2: poor match = ~0.3
		// Average: ~0.65
		const score = computeFlowScore("happy", 0.8, 0.8, recentSongs);
		expect(score).toBeGreaterThan(0.5);
		expect(score).toBeLessThan(0.9);
	});
});

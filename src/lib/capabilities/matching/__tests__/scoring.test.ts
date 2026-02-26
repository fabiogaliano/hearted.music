/**
 * Tests for matching scoring algorithms.
 */

import { describe, expect, it } from "vitest";
import { computeAudioFeatureScore } from "../scoring";
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
		const score = computeAudioFeatureScore(songFeatures, centroid, zeroWeights);
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
		const score = computeAudioFeatureScore(
			features,
			centroid,
			weights as AudioFeatureWeights,
		);
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

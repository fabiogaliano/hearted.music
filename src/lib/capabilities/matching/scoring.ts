/**
 * Scoring utilities for playlist matching.
 *
 * Audio feature comparison between songs and playlist centroids.
 * Scores are normalized to 0-1 range.
 */

import type { AudioFeatureWeights, MatchingAudioFeatures } from "./types";

/**
 * Compare audio features between a song and playlist centroid.
 * Uses weighted absolute difference.
 *
 * @returns Score 0-1 (1 = perfect match)
 */
export function computeAudioFeatureScore(
	songFeatures: MatchingAudioFeatures,
	playlistCentroid: Record<string, number>,
	weights: AudioFeatureWeights,
): number {
	let score = 0;
	let totalWeight = 0;

	const features: (keyof MatchingAudioFeatures)[] = [
		"energy",
		"valence",
		"danceability",
		"acousticness",
		"instrumentalness",
		"speechiness",
		"liveness",
		"tempo",
		"loudness",
	];

	for (const feature of features) {
		const songValue = songFeatures[feature];
		const centroidValue = playlistCentroid[feature];
		const weight = weights[feature];

		if (
			songValue !== undefined &&
			centroidValue !== undefined &&
			weight !== undefined
		) {
			let diff: number;

			if (feature === "tempo") {
				// Normalize tempo difference (max considered difference = 100 BPM)
				diff = Math.abs(songValue - centroidValue) / 100;
			} else if (feature === "loudness") {
				// Normalize loudness difference (range -60 to 0, so max diff ~60)
				diff = Math.abs(songValue - centroidValue) / 60;
			} else {
				// Other features are already 0-1
				diff = Math.abs(songValue - centroidValue);
			}

			// Score = 1 - diff (clamped)
			score += weight * Math.max(0, 1 - diff);
			totalWeight += weight;
		}
	}

	if (totalWeight === 0) return 0;

	return score / totalWeight;
}

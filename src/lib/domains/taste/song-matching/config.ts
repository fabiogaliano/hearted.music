/**
 * Matching algorithm configuration.
 *
 * Default weights and thresholds for song-to-playlist matching.
 * Tuned empirically for music recommendation quality.
 */

import type {
	AudioFeatureWeights,
	DataAvailability,
	MatchingConfig,
	MatchingWeights,
} from "./types";

/**
 * Default weights for score factors.
 * Sum should equal 1.0 for interpretable scores.
 */
export const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
	embedding: 0.5,
	audio: 0.3,
	genre: 0.2,
};

/**
 * Weights for individual audio features.
 * Higher weights = more influence on audio score.
 */
export const DEFAULT_AUDIO_FEATURE_WEIGHTS: AudioFeatureWeights = {
	energy: 1.0,
	valence: 1.0,
	danceability: 0.8,
	acousticness: 0.6,
	instrumentalness: 0.5,
	speechiness: 0.4,
	liveness: 0.3,
	tempo: 0.7,
	loudness: 0.3,
};

/** Default matching configuration */
export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
	weights: DEFAULT_MATCHING_WEIGHTS,
	audioWeights: DEFAULT_AUDIO_FEATURE_WEIGHTS,
	minScoreThreshold: 0.3,
	maxResultsPerSong: 10,
	skipVectorScoring: false,
	vetoThreshold: 0.2,
};

/**
 * Compute adaptive weights based on available data.
 * Redistributes weight from missing factors to available ones proportionally.
 */
export function computeAdaptiveWeights(
	availability: DataAvailability,
): MatchingWeights {
	const base = { ...DEFAULT_MATCHING_WEIGHTS };

	let unavailableWeight = 0;
	const available: (keyof typeof base)[] = [];

	if (!availability.hasEmbedding) {
		unavailableWeight += base.embedding;
		base.embedding = 0;
	} else {
		available.push("embedding");
	}

	if (!availability.hasAudioFeatures) {
		unavailableWeight += base.audio;
		base.audio = 0;
	} else {
		available.push("audio");
	}

	if (!availability.hasGenres) {
		unavailableWeight += base.genre;
		base.genre = 0;
	} else {
		available.push("genre");
	}

	if (available.length > 0 && unavailableWeight > 0) {
		const totalAvailable = available.reduce((sum, key) => sum + base[key], 0);
		for (const key of available) {
			base[key] += unavailableWeight * (base[key] / totalAvailable);
		}
	}

	return base;
}

/** Score tier boundaries */
export const SCORE_TIERS = {
	excellent: 0.8,
	good: 0.6,
	fair: 0.4,
	poor: 0.2,
} as const;

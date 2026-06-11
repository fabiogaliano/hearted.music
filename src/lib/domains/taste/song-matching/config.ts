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
const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
	embedding: 0.5,
	audio: 0.3,
	genre: 0.2,
};

/**
 * Weights used when a playlist has declared genre pills.
 *
 * Genre is raised to 0.40 (the "strong steer" decision: pills declare "this
 * playlist is about these genres", so genre should be the largest factor).
 * Embedding and audio are trimmed proportionally to keep the sum at 1.0.
 * These are provisional values calibrated against production boost-magnitude
 * precedents (Qdrant/Algolia/Elastic: +0.25–0.35 additive / ×1.3–2.0×
 * multiplicative — our 2× bump inside z-normalized fusion is in family).
 * Revisit with the offline replay harness once decision volume grows.
 */
export const WEIGHTS_WITH_DECLARED_GENRES: MatchingWeights = {
	embedding: 0.35,
	audio: 0.25,
	genre: 0.4,
};

/**
 * Weights for individual audio features.
 * Higher weights = more influence on audio score.
 */
const DEFAULT_AUDIO_FEATURE_WEIGHTS: AudioFeatureWeights = {
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
	weightsWithDeclaredGenres: WEIGHTS_WITH_DECLARED_GENRES,
	audioWeights: DEFAULT_AUDIO_FEATURE_WEIGHTS,
	// Threshold is now in normalized-fused units (signals z-scored to [0,1],
	// median ≈ 0.5). 0.35 keeps everything but the clearly-below-average tail —
	// a permissive, recall-leaning placeholder until the offline replay harness
	// (matching-system-roadmap #2) can tune it against the match_decision log.
	// The fallback path's legacy stretch keeps its scores roughly on the old raw
	// scale (where the threshold was 0.3), so one permissive value serves both.
	minScoreThreshold: 0.35,
	maxResultsPerSong: 10,
	skipVectorScoring: false,
	normalization: {
		enabled: true,
		method: "zscore",
		minSamples: 8,
		fallbackSimilarityBaseline: 0.5,
	},
};

/**
 * Genre similarity banding constants.
 *
 * Raw similarity values from the genresgraph-compiled table are capped at
 * ADJACENT_MAX so adjacent genres (related edges 0.5, subgenre edges 0.6)
 * yield partial credit rather than the full 1.0 reserved for exact matches.
 * Values below ADJACENT_FLOOR are treated as unrelated (credit = 0) to
 * avoid giving distant genres spurious signal from low-confidence entries.
 * See plan §1.3 "Provisional constants" for calibration basis.
 */
export const ADJACENT_MAX = 0.6;
export const ADJACENT_FLOOR = 0.3;

/**
 * Select the base weight set for a playlist before adaptive redistribution.
 *
 * Playlists with declared genre pills get a higher genre weight (strong-steer
 * decision). The result is then fed into `computeAdaptiveWeights` so missing
 * signals are still redistributed correctly — this function only picks the
 * starting point, never touches z-score stats or normalization.
 */
export function selectBaseWeights(
	config: Pick<MatchingConfig, "weights" | "weightsWithDeclaredGenres">,
	hasGenrePills: boolean,
): MatchingWeights {
	return hasGenrePills ? config.weightsWithDeclaredGenres : config.weights;
}

/**
 * Compute adaptive weights based on available data.
 * Redistributes weight from missing factors to available ones proportionally.
 */
export function computeAdaptiveWeights(
	availability: DataAvailability,
	baseWeights: MatchingWeights = DEFAULT_MATCHING_WEIGHTS,
): MatchingWeights {
	const base = { ...baseWeights };

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

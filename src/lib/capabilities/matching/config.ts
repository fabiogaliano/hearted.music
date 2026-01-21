/**
 * Matching algorithm configuration.
 *
 * Default weights and thresholds for song-to-playlist matching.
 * Tuned empirically for music recommendation quality.
 */

import type {
	AudioFeatureWeights,
	MatchingConfig,
	MatchingWeights,
} from "./types";

// ============================================================================
// Default Weights
// ============================================================================

/**
 * Default weights for score factors.
 * Sum should equal 1.0 for interpretable scores.
 * Based on old matching-config.ts "fullDataAvailable" profile.
 */
export const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
	vector: 0.25, // Embedding similarity
	genre: 0.15, // Genre/metadata match
	audio: 0.25, // Audio features for "feel" matching
	semantic: 0.15, // Thematic alignment
	context: 0.15, // Listening context fit
	flow: 0.05, // Flow compatibility with recent songs
};

/**
 * Weights for individual audio features.
 * Higher weights = more influence on audio score.
 */
export const DEFAULT_AUDIO_FEATURE_WEIGHTS: AudioFeatureWeights = {
	energy: 1.0, // Very important for playlist cohesion
	valence: 1.0, // Mood consistency
	danceability: 0.8, // Rhythm feel
	acousticness: 0.6, // Production style
	instrumentalness: 0.5, // Vocal preference
	speechiness: 0.4, // Speech vs music
	liveness: 0.3, // Studio vs live feel
	tempo: 0.7, // BPM matching (normalized)
	loudness: 0.3, // Dynamic range (less important)
};

// ============================================================================
// Default Configuration
// ============================================================================

/** Default matching configuration */
export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
	weights: DEFAULT_MATCHING_WEIGHTS,
	audioWeights: DEFAULT_AUDIO_FEATURE_WEIGHTS,
	minScoreThreshold: 0.3, // Minimum score to include
	maxResultsPerSong: 10, // Max playlists per song
	skipVectorScoring: false,
	deepAnalysisThreshold: 0.1, // ~15% of max early score to run deep analysis
	vetoThreshold: 0.2, // Scores below this are vetoed
};

// ============================================================================
// Adaptive Weights
// ============================================================================

/** Data availability for adaptive weight computation */
export interface DataAvailability {
	hasEmbedding: boolean;
	hasGenres: boolean;
	hasAudioFeatures: boolean;
	hasAnalysis: boolean;
	hasRecentSongs: boolean;
}

/**
 * Compute adaptive weights based on available data.
 * Redistributes weight from missing factors to available ones.
 * Based on old matching-config.ts weight profiles.
 */
export function computeAdaptiveWeights(
	availability: DataAvailability,
): MatchingWeights {
	const base = { ...DEFAULT_MATCHING_WEIGHTS };

	// Collect unavailable weight to redistribute
	let unavailableWeight = 0;
	let availableFactors = 0;

	if (!availability.hasEmbedding) {
		unavailableWeight += base.vector;
		base.vector = 0;
	} else {
		availableFactors++;
	}

	if (!availability.hasGenres) {
		unavailableWeight += base.genre;
		base.genre = 0;
	} else {
		availableFactors++;
	}

	if (!availability.hasAudioFeatures) {
		unavailableWeight += base.audio;
		base.audio = 0;
	} else {
		availableFactors++;
	}

	if (!availability.hasAnalysis) {
		unavailableWeight += base.semantic + base.context;
		base.semantic = 0;
		base.context = 0;
	} else {
		availableFactors += 2;
	}

	if (!availability.hasRecentSongs) {
		unavailableWeight += base.flow;
		base.flow = 0;
	} else {
		availableFactors++;
	}

	// Redistribute unavailable weight proportionally
	if (availableFactors > 0 && unavailableWeight > 0) {
		const redistribution = unavailableWeight / availableFactors;

		if (base.vector > 0) base.vector += redistribution;
		if (base.genre > 0) base.genre += redistribution;
		if (base.audio > 0) base.audio += redistribution;
		if (base.semantic > 0) base.semantic += redistribution / 2;
		if (base.context > 0) base.context += redistribution / 2;
		if (base.flow > 0) base.flow += redistribution / 4;
	}

	return {
		vector: base.vector,
		genre: base.genre,
		audio: base.audio,
		semantic: base.semantic,
		context: base.context,
		flow: base.flow,
	};
}

// ============================================================================
// Thresholds
// ============================================================================

/** Semantic similarity thresholds */
export const SEMANTIC_THRESHOLDS = {
	/** Minimum similarity for "related" */
	related: 0.5,
	/** Minimum similarity for "similar" */
	similar: 0.65,
	/** Minimum similarity for "very similar" */
	verySimilar: 0.8,
} as const;

/** Score tier boundaries */
export const SCORE_TIERS = {
	/** Excellent match */
	excellent: 0.8,
	/** Good match */
	good: 0.6,
	/** Fair match */
	fair: 0.4,
	/** Poor match */
	poor: 0.2,
} as const;

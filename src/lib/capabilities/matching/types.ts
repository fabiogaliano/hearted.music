/**
 * Matching pipeline types.
 *
 * Defines result structures for song-to-playlist matching.
 */

import { TaggedError } from "better-result";
import type { MLProviderError } from "@/lib/shared/errors/domain/ml";

// ============================================================================
// Result Types
// ============================================================================

/** Individual score factors contributing to final match score */
export interface ScoreFactors {
	/** Cosine similarity of embeddings (0-1) */
	readonly vector: number;
	/** Genre overlap score (0-1) */
	readonly genre: number;
	/** Audio features similarity (0-1) */
	readonly audio: number;
	/** Semantic/thematic alignment (0-1) */
	readonly semantic: number;
	/** Context/mood alignment (0-1) */
	readonly context: number;
	/** Flow compatibility with recent songs (0-1) */
	readonly flow: number;
}

/** Result of matching a song to a playlist */
export interface MatchResult {
	/** Song's internal UUID */
	readonly songId: string;
	/** Playlist's internal UUID */
	readonly playlistId: string;
	/** Final weighted score (0-1) */
	readonly score: number;
	/** Rank within match results (1-based) */
	readonly rank: number;
	/** Individual factor scores */
	readonly factors: ScoreFactors;
	/** Confidence in the match (based on data availability) */
	readonly confidence: number;
	/** Whether result came from cache */
	readonly fromCache: boolean;
}

/** Batch matching result */
export interface BatchMatchResult {
	/** Matches keyed by songId */
	readonly matches: Map<string, MatchResult[]>;
	/** Songs that failed to match */
	readonly failed: string[];
	/** Statistics */
	readonly stats: {
		readonly total: number;
		readonly matched: number;
		readonly cached: number;
		readonly computed: number;
		readonly failed: number;
	};
}

// ============================================================================
// Configuration Types
// ============================================================================

/** Weights for combining score factors */
export interface MatchingWeights {
	/** Weight for vector similarity (default: 0.30) */
	readonly vector: number;
	/** Weight for genre match (default: 0.15) */
	readonly genre: number;
	/** Weight for audio features (default: 0.20) */
	readonly audio: number;
	/** Weight for semantic/thematic alignment (default: 0.15) */
	readonly semantic: number;
	/** Weight for context alignment (default: 0.15) */
	readonly context: number;
	/** Weight for flow compatibility (default: 0.05) */
	readonly flow: number;
}

/** Audio feature weights for similarity calculation */
export interface AudioFeatureWeights {
	readonly energy: number;
	readonly valence: number;
	readonly danceability: number;
	readonly acousticness: number;
	readonly instrumentalness: number;
	readonly speechiness: number;
	readonly liveness: number;
	readonly tempo: number;
	readonly loudness: number;
}

/** Full matching configuration */
export interface MatchingConfig {
	/** Score factor weights */
	readonly weights: MatchingWeights;
	/** Audio feature weights */
	readonly audioWeights: AudioFeatureWeights;
	/** Minimum score to include in results */
	readonly minScoreThreshold: number;
	/** Maximum results per song */
	readonly maxResultsPerSong: number;
	/** Skip vector scoring (for testing) */
	readonly skipVectorScoring: boolean;
	/** Minimum early score to run deep analysis (semantic/context/flow) */
	readonly deepAnalysisThreshold: number;
	/** Veto threshold - scores below this are considered poor matches */
	readonly vetoThreshold: number;
}

// ============================================================================
// Error Types
// ============================================================================

/** Missing required data for matching */
export class MatchingDataError extends TaggedError("MatchingDataError")<{
	message: string;
	songId?: string;
	playlistId?: string;
}>() {
	constructor(message: string, songId?: string, playlistId?: string) {
		super({ message, songId, playlistId });
	}
}

/** Computation error during matching */
export class MatchingComputeError extends TaggedError("MatchingComputeError")<{
	message: string;
	cause?: unknown;
}>() {
	constructor(message: string, cause?: unknown) {
		super({ message, cause });
	}
}

/** Union of matching errors */
export type MatchingError =
	| MatchingDataError
	| MatchingComputeError
	| MLProviderError;

// ============================================================================
// Data Availability Types
// ============================================================================

/** Tracks which data sources are available for a song */
export interface DataAvailability {
	/** Whether song has embedding vector */
	readonly hasEmbedding: boolean;
	/** Whether song has genre data */
	readonly hasGenres: boolean;
	/** Whether song has audio features */
	readonly hasAudioFeatures: boolean;
	/** Whether song has analysis data */
	readonly hasAnalysis: boolean;
}

// ============================================================================
// Input Types
// ============================================================================

/** Audio features for matching (subset of ReccoBeats features) */
export interface MatchingAudioFeatures {
	readonly energy: number;
	readonly valence: number;
	readonly danceability: number;
	readonly acousticness: number;
	readonly instrumentalness: number;
	readonly speechiness: number;
	readonly liveness: number;
	readonly tempo: number;
	readonly loudness: number;
}

/** Song analysis data for semantic matching */
export interface MatchingSongAnalysis {
	/** Dominant mood (e.g., "happy", "melancholic") */
	readonly dominantMood: string | null;
	/** Themes from song meaning */
	readonly themes: string[];
	/** Listening contexts (e.g., "workout", "study") with scores */
	readonly listeningContexts: Record<string, number>;
}

/** Song data needed for matching */
export interface MatchingSong {
	readonly id: string;
	readonly spotifyId: string;
	readonly name: string;
	readonly artists: string[];
	readonly genres: string[] | null;
	/** Audio features (optional - enables audio scoring) */
	readonly audioFeatures?: MatchingAudioFeatures | null;
	/** Analysis data (optional - enables semantic/context scoring) */
	readonly analysis?: MatchingSongAnalysis | null;
}

/** Playlist profile data needed for matching */
export interface MatchingPlaylistProfile {
	readonly playlistId: string;
	readonly embedding: number[] | null;
	readonly audioCentroid: Record<string, number>;
	readonly genreDistribution: Record<string, number>;
	readonly emotionDistribution: Record<string, number>;
	/** Themes from playlist analysis */
	readonly themes?: string[];
	/** Average listening context scores */
	readonly listeningContexts?: Record<string, number>;
	/** Recent songs for flow scoring (last 3-5) */
	readonly recentSongs?: ReadonlyArray<{
		readonly dominantMood: string | null;
		readonly energy: number;
		readonly valence: number;
	}>;
	/** Profile method for adaptive weights */
	readonly method?: "learned_from_songs" | "from_description";
}

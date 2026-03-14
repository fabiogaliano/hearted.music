/**
 * Matching pipeline types.
 *
 * Defines result structures for song-to-playlist matching.
 */

import { TaggedError } from "better-result";
import type { MLProviderError } from "@/lib/shared/errors/domain/ml";

export interface ScoreFactors {
	readonly embedding: number;
	readonly audio: number;
	readonly genre: number;
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

/** Weights for combining score factors */
export interface MatchingWeights {
	readonly embedding: number;
	readonly audio: number;
	readonly genre: number;
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
	/** Veto threshold - scores below this are considered poor matches */
	readonly vetoThreshold: number;
}

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

/** Tracks which data sources are available for a song */
export interface DataAvailability {
	readonly hasEmbedding: boolean;
	readonly hasGenres: boolean;
	readonly hasAudioFeatures: boolean;
}

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

/** Song data needed for matching */
export interface MatchingSong {
	readonly id: string;
	readonly spotifyId: string;
	readonly name: string;
	readonly artists: string[];
	readonly genres: string[] | null;
	/** Audio features (optional - enables audio scoring) */
	readonly audioFeatures?: MatchingAudioFeatures | null;
}

/** Playlist profile data needed for matching */
export interface MatchingPlaylistProfile {
	readonly playlistId: string;
	readonly embedding: number[] | null;
	readonly audioCentroid: Record<string, number>;
	readonly genreDistribution: Record<string, number>;
	readonly method?: "learned_from_songs" | "from_description";
}

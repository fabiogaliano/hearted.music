/**
 * Playlist profiling type definitions.
 */

import type { DbError } from "@/lib/shared/errors/database";
import type { MLProviderError } from "@/lib/shared/errors/domain/ml";

// ============================================================================
// Profile Types
// ============================================================================

/** Profile computation method */
export type ProfileKind = "content_v1" | "context_v1";

/** Aggregated audio features centroid */
export interface AudioCentroid {
	readonly energy?: number;
	readonly valence?: number;
	readonly danceability?: number;
	readonly acousticness?: number;
	readonly instrumentalness?: number;
	readonly speechiness?: number;
	readonly liveness?: number;
	readonly tempo?: number;
	readonly loudness?: number;
}

/** Genre frequency distribution */
export type GenreDistribution = Readonly<Record<string, number>>;

/** Emotion frequency distribution */
export type EmotionDistribution = Readonly<Record<string, number>>;

/** Computed playlist profile result */
export interface ComputedPlaylistProfile {
	readonly playlistId: string;
	readonly kind: ProfileKind;
	readonly embedding: number[] | null;
	readonly audioCentroid: AudioCentroid;
	readonly genreDistribution: GenreDistribution;
	readonly emotionDistribution: EmotionDistribution;
	readonly songIds: string[];
	readonly songCount: number;
	readonly contentHash: string;
	readonly modelBundleHash: string;
	readonly fromCache: boolean;
}

// ============================================================================
// Options and Progress Types
// ============================================================================

/** Options for profile computation */
export interface ProfilingOptions {
	/** Skip checking cache (force recompute) */
	readonly skipCache?: boolean;
	/** Skip persisting to database */
	readonly skipPersist?: boolean;
}

/** Progress for batch operations */
export interface ProfileBatchProgress {
	readonly total: number;
	readonly completed: number;
	readonly cached: number;
	readonly computed: number;
	readonly errors: number;
}

/** Progress callback type */
export type ProfileBatchProgressCallback = (
	progress: ProfileBatchProgress,
) => void;

/** Result of batch profiling */
export interface BatchProfilingResult {
	readonly results: Map<string, ComputedPlaylistProfile>;
	readonly errors: Map<string, string>;
	readonly stats: {
		readonly total: number;
		readonly cached: number;
		readonly computed: number;
		readonly failed: number;
	};
}

// ============================================================================
// Error Types
// ============================================================================

/** All profiling-related errors */
export type ProfilingError = DbError | MLProviderError;

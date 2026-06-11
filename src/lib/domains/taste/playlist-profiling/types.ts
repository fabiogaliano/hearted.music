/**
 * Playlist profiling type definitions.
 */

import type { DbError } from "@/lib/shared/errors/database";
import type { MLProviderError } from "@/lib/shared/errors/domain/ml";

/** Profile computation method */
export type ProfileKind = "content_v1";

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

/** Computed playlist profile result */
export interface ComputedPlaylistProfile {
	readonly playlistId: string;
	readonly kind: ProfileKind;
	readonly embedding: number[] | null;
	readonly audioCentroid: AudioCentroid;
	readonly genreDistribution: GenreDistribution;
	readonly songIds: string[];
	readonly songCount: number;
	readonly contentHash: string;
	readonly modelBundleHash: string;
	readonly fromCache: boolean;
}

/** Options for profile computation */
export interface ProfilingOptions {
	/** Skip checking cache (force recompute) */
	readonly skipCache?: boolean;
	/** Skip persisting to database */
	readonly skipPersist?: boolean;
	/** Playlist name (always present) */
	readonly name?: string;
	/** Playlist description (may be empty) */
	readonly description?: string;
	/**
	 * User-declared genre pills (up to 5 canonical genres).
	 * These hold a fixed PILL_SHARE of the genre distribution regardless of song count.
	 * Pills append a ". Genres: ..." suffix to the intent text but do NOT affect
	 * hasDescription — they must not trigger the ×1.5 intent-weight boost.
	 */
	readonly genrePills?: readonly string[];
}

/** All profiling-related errors */
export type ProfilingError = DbError | MLProviderError;

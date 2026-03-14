/**
 * Pure calculation functions for playlist profiling.
 *
 * These are extracted from PlaylistProfilingService to enable
 * focused unit testing without service orchestration complexity.
 */

import type { Song } from "@/lib/domains/library/songs/queries";
import type * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import type { AudioCentroid, GenreDistribution } from "./types";

/**
 * Calculate vector centroid (mean).
 *
 * @param vectors - Array of vectors to average
 * @returns Centroid vector, or empty array if input is empty
 */
export function calculateCentroid(vectors: number[][]): number[] {
	if (vectors.length === 0) return [];
	const dim = vectors[0].length;
	const centroid = new Array<number>(dim).fill(0);
	for (const vec of vectors) {
		for (let i = 0; i < dim; i++) {
			centroid[i] += vec[i];
		}
	}
	return centroid.map((v) => v / vectors.length);
}

/**
 * Calculate audio features centroid.
 * Filters out NaN and undefined values per feature.
 *
 * @param features - Array of audio features
 * @returns Centroid with averaged values per feature
 */
export function calculateAudioCentroid(
	features: audioFeatureData.AudioFeature[],
): AudioCentroid {
	if (features.length === 0) return {};

	const keys = [
		"energy",
		"valence",
		"danceability",
		"acousticness",
		"instrumentalness",
		"speechiness",
		"liveness",
		"tempo",
		"loudness",
	] as const;

	const centroid: Record<string, number> = {};

	for (const key of keys) {
		const values = features
			.map((f) => f[key])
			.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
		if (values.length > 0) {
			centroid[key] = values.reduce((sum, v) => sum + v, 0) / values.length;
		}
	}

	return centroid as AudioCentroid;
}

/**
 * Compute genre distribution from songs.
 * Accumulates counts for each genre across all songs.
 *
 * @param songs - Array of songs with optional genres
 * @returns Genre counts { genre: count }
 */
export function computeGenreDistribution(songs: Song[]): GenreDistribution {
	const counts: Record<string, number> = {};
	for (const song of songs) {
		if (song.genres) {
			for (const genre of song.genres) {
				counts[genre] = (counts[genre] ?? 0) + 1;
			}
		}
	}
	return counts;
}

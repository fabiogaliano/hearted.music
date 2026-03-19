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

// Intent blending tuning constants
const INTENT_BASE_WEIGHT = 0.35;
const INTENT_DESC_BOOST = 1.5;
const INTENT_MATURITY_THRESHOLD = 30;
const INTENT_FLOOR_WITH_DESC = 0.3;
const INTENT_FLOOR_NAME_ONLY = 0.15;

function l2Normalize(vec: number[]): number[] {
	let norm = 0;
	for (let i = 0; i < vec.length; i++) {
		norm += vec[i] * vec[i];
	}
	norm = Math.sqrt(norm);
	if (norm === 0) return vec;
	return vec.map((v) => v / norm);
}

/**
 * Blend song centroid with intent embedding using weighted average.
 * Both vectors are L2-normalized before blending to prevent magnitude bias,
 * and the result is re-normalized for stable cosine similarity.
 */
export function blendEmbeddings(
	songCentroid: number[],
	intentEmbedding: number[] | null,
	intentWeight: number,
): number[] {
	if (!intentEmbedding || intentEmbedding.length === 0) return songCentroid;
	if (songCentroid.length === 0) return intentEmbedding;

	const normContent = l2Normalize(songCentroid);
	const normIntent = l2Normalize(intentEmbedding);
	const cw = 1 - intentWeight;

	const blended = normContent.map(
		(v, i) => cw * v + intentWeight * normIntent[i],
	);
	return l2Normalize(blended);
}

/**
 * Compute how much the intent embedding (name + description) should
 * influence the final profile embedding.
 *
 * Higher for sparse/new playlists, lower for established ones.
 * Description presence boosts the weight (richer signal).
 * A floor ensures intent never fully disappears.
 */
export function computeIntentWeight(
	songCount: number,
	hasDescription: boolean,
): number {
	const descBoost = hasDescription ? INTENT_DESC_BOOST : 1.0;
	const decay = Math.max(0, 1.0 - songCount / INTENT_MATURITY_THRESHOLD);
	const weight = INTENT_BASE_WEIGHT * descBoost * decay;
	const floor = hasDescription
		? INTENT_FLOOR_WITH_DESC
		: INTENT_FLOOR_NAME_ONLY;
	return Math.max(floor, Math.min(1.0, weight));
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

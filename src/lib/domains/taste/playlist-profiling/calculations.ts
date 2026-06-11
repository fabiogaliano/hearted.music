/**
 * Pure calculation functions for playlist profiling.
 *
 * These are extracted from PlaylistProfilingService to enable
 * focused unit testing without service orchestration complexity.
 */

import type * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import type { AudioCentroid, GenreDistribution } from "./types";

const AUDIO_CENTROID_KEYS = [
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

type MutableAudioCentroid = {
	-readonly [K in keyof AudioCentroid]: AudioCentroid[K];
};

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

	const centroid: MutableAudioCentroid = {};

	for (const key of AUDIO_CENTROID_KEYS) {
		const values = features
			.map((f) => f[key])
			.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
		if (values.length > 0) {
			centroid[key] = values.reduce((sum, v) => sum + v, 0) / values.length;
		}
	}

	return centroid;
}

export function toAudioCentroidRecord(
	audioCentroid: AudioCentroid,
): Record<string, number> {
	const record: Record<string, number> = {};

	for (const key of AUDIO_CENTROID_KEYS) {
		const value = audioCentroid[key];
		if (typeof value === "number" && !Number.isNaN(value)) {
			record[key] = value;
		}
	}

	return record;
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
 * Build the canonical intent text shared by the embedding query and the reranker query.
 *
 * Keeping both byte-identical prevents the reranker from scoring against a different
 * string than the one that produced the retrieval embedding.
 *
 * Returns undefined when every component is empty — callers use this to skip
 * embedding / HyDE paths entirely.
 */
export function buildIntentText(
	name?: string,
	description?: string,
	pills?: readonly string[],
): string | undefined {
	const base = [name, description].filter(Boolean).join(" — ").trim();
	const activePills = pills?.filter((p) => p.length > 0) ?? [];
	const pillSuffix =
		activePills.length > 0 ? `. Genres: ${activePills.join(", ")}` : "";
	const result = `${base}${pillSuffix}`.trim();
	return result.length > 0 ? result : undefined;
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

/**
 * Fixed share that declared genre pills hold in the blended distribution.
 * Pills are a standing declaration, so the share never decays with song count.
 */
export const PILL_SHARE = 0.5;

/**
 * Blend observed song-genre counts with declared genre pills into a normalized
 * fraction distribution summing to 1.
 *
 * Rules:
 * - No pills → observed counts normalized to fractions (sums to 1; empty stays {}).
 * - Pills + songs → PILL_SHARE for declared (split equally) + (1-PILL_SHARE) for observed.
 * - Pills + 0 songs → declared only, each pill gets 1/pillCount.
 *
 * Storing fractions (not raw counts) clears the raw-counts footgun: computeGenreScore
 * already consumes ratios, so this is transparent to the matching side.
 */
export function blendGenreDistribution(
	observedCounts: GenreDistribution,
	pills: readonly string[],
): GenreDistribution {
	// Drop empty-string pills defensively
	const activePills = pills.filter((p) => p.length > 0);

	const totalObserved = Object.values(observedCounts).reduce(
		(sum, c) => sum + c,
		0,
	);
	const hasSongs = totalObserved > 0;

	if (activePills.length === 0) {
		// No pills — return observed fractions (empty stays empty)
		if (totalObserved === 0) return {};
		const result: Record<string, number> = {};
		for (const [genre, count] of Object.entries(observedCounts)) {
			result[genre] = count / totalObserved;
		}
		return result;
	}

	const pillFraction = PILL_SHARE / activePills.length;

	if (!hasSongs) {
		// No members — pills are 100% of the signal
		const result: Record<string, number> = {};
		for (const pill of activePills) {
			result[pill] = (result[pill] ?? 0) + 1 / activePills.length;
		}
		return result;
	}

	// Both pills and songs — blend PILL_SHARE declared + (1-PILL_SHARE) observed
	const result: Record<string, number> = {};

	for (const pill of activePills) {
		result[pill] = (result[pill] ?? 0) + pillFraction;
	}

	const observedShare = 1 - PILL_SHARE;
	for (const [genre, count] of Object.entries(observedCounts)) {
		const fraction = (count / totalObserved) * observedShare;
		result[genre] = (result[genre] ?? 0) + fraction;
	}

	return result;
}

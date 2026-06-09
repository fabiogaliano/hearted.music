/**
 * Per-candidate-set signal normalization for score fusion.
 *
 * Raw factor scores live on incompatible scales: E5-family embedding cosines
 * cluster in a narrow ~0.75-0.90 band (low-temperature InfoNCE anisotropy),
 * while audio and genre scores span the full 0-1. A weighted sum over the raw
 * values therefore gives the embedding far less *differential* influence than
 * its nominal weight implies. Normalizing each signal against the distribution
 * of the current candidate set restores that influence, so the configured
 * weights mean what they say.
 *
 * The direction decision (normalize across the whole batch matrix rather than
 * per-song or per-playlist) is recorded in
 * `docs/architecture/score-normalization-direction.md`. The z-score path mirrors
 * Qdrant's DBSF; the min-max path mirrors Weaviate's relativeScoreFusion.
 */

export type NormalizationMethod = "zscore" | "minmax";

export interface SignalStats {
	/** Number of samples the stats were computed from (available pairs only). */
	readonly n: number;
	readonly min: number;
	readonly max: number;
	readonly mean: number;
	/** Population standard deviation (divides by n, so n=1 yields 0 → neutral). */
	readonly std: number;
}

const EPSILON = 1e-9;

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

/**
 * Compute distribution stats for one signal across a candidate set.
 *
 * Callers must pass only the values for pairs where the signal is actually
 * available — feeding the implicit `0` of a missing signal would drag the
 * distribution and re-introduce the mis-scaling this module exists to remove.
 */
export function computeSignalStats(values: number[]): SignalStats {
	const n = values.length;
	if (n === 0) {
		return { n: 0, min: 0, max: 0, mean: 0, std: 0 };
	}

	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	let sum = 0;
	for (const value of values) {
		if (value < min) min = value;
		if (value > max) max = value;
		sum += value;
	}
	const mean = sum / n;

	let varianceSum = 0;
	for (const value of values) {
		const delta = value - mean;
		varianceSum += delta * delta;
	}
	const std = Math.sqrt(varianceSum / n);

	return { n, min, max, mean, std };
}

/**
 * Map a raw signal value into [0,1] using its candidate-set distribution.
 *
 * - `zscore`: 3σ-clipped standardization mapped to [0,1] via `(z+3)/6`. The clip
 *   bounds the narrow-band/outlier behavior of embedding cosines (Qdrant DBSF).
 * - `minmax`: linear rescale between observed min and max (Weaviate).
 *
 * Returns the neutral `0.5` when the set has no spread (std/range ≈ 0, which
 * includes single-sample sets): there is nothing to rank on, so every candidate
 * ties. This is the same degenerate-set convention DBSF uses to avoid dividing
 * by zero.
 */
export function normalizeSignal(
	value: number,
	stats: SignalStats,
	method: NormalizationMethod,
): number {
	if (stats.n === 0) return 0.5;

	if (method === "minmax") {
		const range = stats.max - stats.min;
		if (range < EPSILON) return 0.5;
		return clamp01((value - stats.min) / range);
	}

	if (stats.std < EPSILON) return 0.5;
	const z = (value - stats.mean) / stats.std;
	const clipped = Math.max(-3, Math.min(3, z));
	return (clipped + 3) / 6;
}

/**
 * Legacy linear stretch for embedding cosines: baseline→0, 1.0→1.0.
 *
 * Used only on the fallback path, when candidate-set normalization is
 * unavailable (disabled, or the signal is under-sampled). Without it the raw
 * ~0.75–0.90 cosine band would have even less differential influence there
 * than the pre-normalization code this module replaced.
 */
export function stretchFromBaseline(value: number, baseline: number): number {
	if (baseline >= 1 - EPSILON) return clamp01(value);
	return clamp01((value - baseline) / (1 - baseline));
}

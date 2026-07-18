/**
 * ReccoBeats audio-file analysis client + feature-aware aggregation.
 *
 * The file endpoint (POST /v1/analysis/audio-features, multipart audioFile,
 * <=5MB, <=30s, truncates beyond 30s) returns the 9 numeric features only — no
 * key/mode/time_signature. ReccoBeats documents the multi-clip approach for
 * longer audio: split into clips, extract per clip, then average. We aggregate
 * feature-aware rather than blindly: bounded features by duration-weighted mean,
 * loudness in linear power space, tempo by half/double-normalized weighted
 * median.
 */

import { readFile } from "node:fs/promises";
import { Result } from "better-result";
import { z } from "zod";
import type { UpsertData } from "@/lib/domains/enrichment/audio-features/queries";
import { errorMessage } from "@/lib/shared/errors/error-message";
import {
	ReccoBeatsApiError,
	type ReccoBeatsError,
	ReccoBeatsRateLimitError,
} from "@/lib/shared/errors/external/reccobeats";
import { withRetry } from "@/lib/shared/utils/result-wrappers/generic";

const FILE_ANALYSIS_URL =
	"https://api.reccobeats.com/v1/analysis/audio-features";
const REQUEST_TIMEOUT_MS = 60_000;

const ReccoBeatsFileFeaturesSchema = z.object({
	acousticness: z.number(),
	danceability: z.number(),
	energy: z.number(),
	instrumentalness: z.number(),
	liveness: z.number(),
	loudness: z.number(),
	speechiness: z.number(),
	tempo: z.number(),
	valence: z.number(),
});

export type RawClipFeatures = z.infer<typeof ReccoBeatsFileFeaturesSchema>;

export interface ClipAnalysis {
	features: RawClipFeatures;
	durationSeconds: number;
}

export type AggregatedFeatures = RawClipFeatures;

export interface AggregationMetadata {
	method: string;
	clipDurationsSeconds: number[];
	tempoStrategy: string;
	tempoConfidence: "high" | "low";
	featureStdDev: Record<string, number>;
}

const BOUNDED_FEATURES = [
	"acousticness",
	"danceability",
	"energy",
	"instrumentalness",
	"liveness",
	"speechiness",
	"valence",
] as const;

const RETRY_OPTIONS = {
	maxRetries: 2,
	baseDelayMs: 1_000,
	maxDelayMs: 15_000,
	isRetryable: (error: ReccoBeatsError) => {
		if (error instanceof ReccoBeatsRateLimitError) return true;
		if (error instanceof ReccoBeatsApiError) {
			return error.statusCode === 0 || error.statusCode >= 500;
		}
		return false;
	},
	getRetryAfterMs: (error: ReccoBeatsError) =>
		error instanceof ReccoBeatsRateLimitError ? error.retryAfterMs : undefined,
} as const;

// ===========================================================================
// IO
// ===========================================================================

async function analyzeClipOnce(
	filePath: string,
	signal?: AbortSignal,
): Promise<Result<RawClipFeatures, ReccoBeatsError>> {
	const bytesResult = await Result.tryPromise({
		try: () => readFile(filePath),
		catch: (e) => new ReccoBeatsApiError(0, errorMessage(e), e),
	});
	if (Result.isError(bytesResult)) return Result.err(bytesResult.error);
	signal?.throwIfAborted();

	const form = new FormData();
	form.append(
		"audioFile",
		new Blob([bytesResult.value], { type: "audio/mpeg" }),
		"clip.mp3",
	);

	const fetchResult = await Result.tryPromise({
		try: () =>
			fetch(FILE_ANALYSIS_URL, {
				method: "POST",
				body: form,
				signal: signal
					? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
					: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			}),
		catch: (e) => new ReccoBeatsApiError(0, errorMessage(e), e),
	});
	if (Result.isError(fetchResult)) {
		signal?.throwIfAborted();
		return Result.err(fetchResult.error);
	}

	const response = fetchResult.value;

	if (response.status === 429) {
		const retryAfter = response.headers.get("Retry-After");
		const retryMs = retryAfter
			? Number.parseInt(retryAfter, 10) * 1000
			: undefined;
		return Result.err(new ReccoBeatsRateLimitError(retryMs));
	}
	if (!response.ok) {
		return Result.err(
			new ReccoBeatsApiError(response.status, response.statusText),
		);
	}

	const jsonResult = await Result.tryPromise({
		try: () => response.json(),
		catch: () => new ReccoBeatsApiError(0, "Failed to parse JSON response"),
	});
	if (Result.isError(jsonResult)) return Result.err(jsonResult.error);

	const parsed = ReccoBeatsFileFeaturesSchema.safeParse(jsonResult.value);
	if (!parsed.success) {
		return Result.err(
			new ReccoBeatsApiError(
				0,
				`Invalid file-analysis response: ${parsed.error.message}`,
			),
		);
	}
	return Result.ok(parsed.data);
}

export function analyzeClip(
	filePath: string,
	signal?: AbortSignal,
): Promise<Result<RawClipFeatures, ReccoBeatsError>> {
	return withRetry(() => {
		signal?.throwIfAborted();
		return analyzeClipOnce(filePath, signal);
	}, RETRY_OPTIONS);
}

/**
 * Analyze every clip sequentially. Requires all to succeed after per-clip
 * retries — a partial set is failed rather than averaged, so we never persist
 * features derived from incomplete data. Callers hold the provider lease around
 * this so global ReccoBeats concurrency stays at 1.
 */
export async function analyzeClipsAll(
	clips: { path: string; durationSeconds: number }[],
	signal?: AbortSignal,
): Promise<Result<ClipAnalysis[], ReccoBeatsError>> {
	const out: ClipAnalysis[] = [];
	for (const clip of clips) {
		signal?.throwIfAborted();
		const result = await analyzeClip(clip.path, signal);
		if (Result.isError(result)) return Result.err(result.error);
		out.push({ features: result.value, durationSeconds: clip.durationSeconds });
	}
	return Result.ok(out);
}

// ===========================================================================
// Aggregation (pure)
// ===========================================================================

function weightedMean(values: number[], weights: number[]): number {
	if (values.length === 0) return 0;
	let totalW = 0;
	let acc = 0;
	for (let i = 0; i < values.length; i++) {
		const rawWeight = weights[i] ?? 0;
		const w = rawWeight > 0 ? rawWeight : 1;
		acc += (values[i] ?? 0) * w;
		totalW += w;
	}
	return totalW > 0 ? acc / totalW : 0;
}

function weightedMedian(values: number[], weights: number[]): number {
	if (values.length === 0) return 0;
	const pairs = values
		.map((v, i) => {
			const rawWeight = weights[i] ?? 0;
			return { v, w: rawWeight > 0 ? rawWeight : 1 };
		})
		.sort((a, b) => a.v - b.v);
	const total = pairs.reduce((s, p) => s + p.w, 0);
	let cum = 0;
	for (const p of pairs) {
		cum += p.w;
		if (cum >= total / 2) return p.v;
	}
	return pairs.at(-1)?.v ?? 0;
}

function stdDev(values: number[]): number {
	if (values.length <= 1) return 0;
	const mean = values.reduce((s, v) => s + v, 0) / values.length;
	const variance =
		values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

/** Map a clip tempo to the half/double variant closest to the reference. */
function normalizeTempoToReference(tempo: number, reference: number): number {
	const variants = [tempo / 2, tempo, tempo * 2].filter(
		(t) => t >= 30 && t <= 300,
	);
	if (variants.length === 0) return tempo;
	return variants.reduce((best, t) =>
		Math.abs(t - reference) < Math.abs(best - reference) ? t : best,
	);
}

export function aggregateClipFeatures(
	clips: ClipAnalysis[],
	config: { tempoHalfDoubleTolerance: number },
): { features: AggregatedFeatures; metadata: AggregationMetadata } {
	if (clips.length === 0) {
		throw new Error("aggregateClipFeatures requires at least one clip");
	}

	const durations = clips.map((c) => c.durationSeconds);
	const featureStdDev: Record<string, number> = {};

	const bounded = Object.fromEntries(
		BOUNDED_FEATURES.map((key) => {
			const values = clips.map((c) => c.features[key]);
			featureStdDev[key] = stdDev(values);
			return [key, weightedMean(values, durations)] as const;
		}),
	) as Record<(typeof BOUNDED_FEATURES)[number], number>;

	// Loudness in dB averages in linear power space, not directly.
	const loudnessLinear = clips.map((c) => 10 ** (c.features.loudness / 10));
	const loudness = 10 * Math.log10(weightedMean(loudnessLinear, durations));
	featureStdDev.loudness = stdDev(clips.map((c) => c.features.loudness));

	// Tempo: weighted-median reference, normalize half/double, weighted median.
	const rawTempos = clips.map((c) => c.features.tempo);
	const reference = weightedMedian(rawTempos, durations);
	const normalizedTempos = rawTempos.map((t) =>
		normalizeTempoToReference(t, reference),
	);
	const tempo = weightedMedian(normalizedTempos, durations);
	featureStdDev.tempo = stdDev(normalizedTempos);

	const tempoSpread =
		tempo > 0
			? Math.max(0, ...normalizedTempos.map((t) => Math.abs(t - tempo) / tempo))
			: 0;
	const tempoConfidence: "high" | "low" =
		clips.length === 1 || tempoSpread <= config.tempoHalfDoubleTolerance
			? "high"
			: "low";

	return {
		features: {
			acousticness: bounded.acousticness,
			danceability: bounded.danceability,
			energy: bounded.energy,
			instrumentalness: bounded.instrumentalness,
			liveness: bounded.liveness,
			loudness,
			speechiness: bounded.speechiness,
			tempo,
			valence: bounded.valence,
		},
		metadata: {
			method: "duration_weighted_feature_aware_v1",
			clipDurationsSeconds: durations,
			tempoStrategy: "weighted_median_half_double_normalized",
			tempoConfidence,
			featureStdDev,
		},
	};
}

/** Backfilled rows carry the 9 numeric features; key/mode/time_signature are
 * null because the file endpoint never returns them, and song-matching scoring
 * never reads them. */
export function mapAggregatedToUpsert(
	songId: string,
	features: AggregatedFeatures,
): UpsertData {
	return {
		song_id: songId,
		acousticness: features.acousticness,
		danceability: features.danceability,
		energy: features.energy,
		instrumentalness: features.instrumentalness,
		liveness: features.liveness,
		loudness: features.loudness,
		speechiness: features.speechiness,
		tempo: features.tempo,
		valence: features.valence,
		key: null,
		mode: null,
		time_signature: null,
	};
}

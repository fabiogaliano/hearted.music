import { Result } from "better-result";
import { env } from "@/env";
import type { AudioFeature } from "@/lib/domains/enrichment/audio-features/queries";
import { getBatch as getAudioFeaturesBatch } from "@/lib/domains/enrichment/audio-features/queries";
import { getByIds as getSongsByIds } from "@/lib/domains/library/songs/queries";
import { resolveLlmConfig } from "@/lib/integrations/llm/config";
import { LlmService } from "@/lib/integrations/llm/service";
import {
	NoLyricsAvailableError,
	PipelineConfigError,
} from "@/lib/shared/errors/domain/analysis";
import {
	GeniusConfigError,
	type GeniusError,
	GeniusFetchError,
	GeniusNotFoundError,
	GeniusParseError,
} from "@/lib/shared/errors/external/genius";
import { chunkArray } from "@/lib/shared/utils/concurrency";
import { createLrclibProvider } from "../lyrics/providers/lrclib";
import { LyricsService } from "../lyrics/service";
import type { LyricsOutcome } from "../lyrics/types/lyrics.types";
import { ensureAnnotationDistillations } from "./annotation-distillation";
import {
	type AnalysisFailureClassification,
	classifyAnalysisFailure,
} from "./failure-classification";
import type { AnalyzeSongInput } from "./song-analysis";
import { isRetryCandidate, SongAnalysisService } from "./song-analysis";

export interface BatchSong {
	songId: string;
	artist: string;
	title: string;
	lyrics: string;
	/** Album name passed to LRCLIB's full track signature (/api/get requires it). */
	albumName?: string;
	/** Track duration in seconds (converted from song.duration_ms) for LRCLIB's ±2s matching. */
	durationSec?: number;
}

export interface BatchAnalysisOutcome {
	analyzedSongIds: string[];
	failedSongIds: string[];
	/** Per-song structured failure verdict so the stage can preserve retry metadata. */
	failureClassifications: Map<string, AnalysisFailureClassification>;
	skippedConfirmedInputsMissing: string[];
	skippedUnconfirmedLyrics: string[];
	skippedUnconfirmedAudio: string[];
	skippedUnconfirmedBoth: string[];
	/**
	 * Songs whose classifier resolved to "unknown" — no authoritative signal
	 * (confirmed-instrumental outcome, lyrics, genre keyword, or
	 * instrumentalness ≥ 0.9). These are retry candidates: no analysis row was
	 * written, the song should be re-selected on the next run once better data
	 * (e.g. a new LRCLIB record) is available.
	 */
	retryCandidateSongIds: string[];
	/**
	 * Underlying provider error per song for blocked-skip buckets
	 * (skippedUnconfirmedLyrics / Audio / Both). The stage threads these into
	 * StageFailure.message / provider / statusCode / causeTag so failure rows
	 * carry the real error detail instead of a canned message (§7.1).
	 */
	blockedSkipErrors: Map<string, LyricsPrefetchError>;
}

export interface BatchAnalysisConfig {
	concurrency?: number;
	provider?: "google" | "google-vertex" | "anthropic" | "openai";
}

type InputEvidence = "present" | "missing_confirmed" | "missing_unconfirmed";

export type LyricsPrefetchError =
	| GeniusError
	| NoLyricsAvailableError
	| PipelineConfigError;

interface LyricsCacheEntry {
	lyrics: string | null;
	error?: LyricsPrefetchError;
	/** Resolved outcome when the fetch succeeded; threaded into AnalyzeSongInput. */
	outcome?: LyricsOutcome;
}

type LyricsCache = Map<string, LyricsCacheEntry>;

function isGeniusError(error: unknown): error is GeniusError {
	return (
		error instanceof GeniusNotFoundError ||
		error instanceof GeniusParseError ||
		error instanceof GeniusFetchError ||
		error instanceof GeniusConfigError
	);
}

function classifyLyricsEvidence(
	song: BatchSong,
	cache: LyricsCache,
): InputEvidence {
	if (song.lyrics && song.lyrics.trim().length > 0) return "present";

	const entry = cache.get(song.songId);
	if (!entry) return "missing_unconfirmed";

	if (entry.lyrics !== null && entry.lyrics.trim().length > 0) return "present";

	// Confirmed-instrumental and not_found outcomes are authoritative "no text
	// lyrics" signals (replacing the seam that collapsed both to
	// NoLyricsAvailableError). The song still proceeds to analysis via the
	// classifier — routing is the classifier's job; here we only test
	// "did the fetch definitively resolve?".
	if (
		entry.outcome?.kind === "instrumental" ||
		entry.outcome?.kind === "not_found"
	) {
		return "missing_confirmed";
	}

	if (entry.error instanceof NoLyricsAvailableError) return "missing_confirmed";
	if (entry.error === undefined) return "missing_confirmed";

	return "missing_unconfirmed";
}

function classifyAudioEvidence(
	songId: string,
	audioFeaturesAvailable: boolean,
	audioFeaturesMap: Map<string, AudioFeature>,
): InputEvidence {
	if (!audioFeaturesAvailable) return "missing_unconfirmed";
	return audioFeaturesMap.has(songId) ? "present" : "missing_confirmed";
}

async function prefetchLyrics(
	songs: BatchSong[],
	lyricsService: LyricsService | null,
): Promise<LyricsCache> {
	const cache: LyricsCache = new Map();

	if (!lyricsService) return cache;

	const songsNeedingLyrics = songs.filter(
		(s) => !s.lyrics || s.lyrics.trim().length === 0,
	);
	if (songsNeedingLyrics.length === 0) return cache;

	await Promise.all(
		songsNeedingLyrics.map(async (song) => {
			try {
				const outcomeResult = await lyricsService.fetchAndStoreOutcome({
					songId: song.songId,
					artist: song.artist,
					song: song.title,
					albumName: song.albumName,
					// BatchSong.durationSec is in seconds; FetchOutcomeParams needs ms
					durationMs:
						song.durationSec !== undefined
							? song.durationSec * 1000
							: undefined,
					distiller: ensureAnnotationDistillations,
				});

				if (Result.isOk(outcomeResult)) {
					const outcome = outcomeResult.value;
					if (outcome.kind === "lyrics") {
						// Store text AND outcome so the classifier sees the fetch signal.
						cache.set(song.songId, { lyrics: outcome.text, outcome });
					} else {
						// instrumental or not_found: store the outcome so the classifier
						// can apply the confirmed-instrumental signal at step 1.
						cache.set(song.songId, { lyrics: null, outcome });
					}
				} else {
					// Transient provider failure — unconfirmed, eligible for retry
					const error = outcomeResult.error;
					const prefetchError = isGeniusError(error)
						? error
						: new PipelineConfigError(
								`Unexpected lyrics prefetch failure for ${song.artist} - ${song.title}`,
							);
					cache.set(song.songId, { lyrics: null, error: prefetchError });
				}
			} catch (error) {
				const prefetchError = isGeniusError(error)
					? error
					: new PipelineConfigError(
							`Unexpected lyrics prefetch failure for ${song.artist} - ${song.title}`,
						);
				cache.set(song.songId, { lyrics: null, error: prefetchError });
			}
		}),
	);

	return cache;
}

export interface SongBatchAnalyzerDeps {
	lyricsService: LyricsService | null;
	songAnalysisService: SongAnalysisService;
	concurrency: number;
}

/**
 * Jobless batch analysis: classifies inputs and runs analysis without
 * creating or managing any job rows. Returns structured buckets the
 * caller can map into stage outcomes or pipeline results.
 */
export async function analyzeSongBatch(
	songs: BatchSong[],
	deps: SongBatchAnalyzerDeps,
): Promise<BatchAnalysisOutcome> {
	if (songs.length === 0) {
		return {
			analyzedSongIds: [],
			failedSongIds: [],
			failureClassifications: new Map(),
			skippedConfirmedInputsMissing: [],
			skippedUnconfirmedLyrics: [],
			skippedUnconfirmedAudio: [],
			skippedUnconfirmedBoth: [],
			retryCandidateSongIds: [],
			blockedSkipErrors: new Map(),
		};
	}

	const songIds = songs.map((s) => s.songId);

	const [lyricsCache, audioFeaturesResult, songsResult] = await Promise.all([
		prefetchLyrics(songs, deps.lyricsService),
		getAudioFeaturesBatch(songIds),
		getSongsByIds(songIds),
	]);

	const audioFeaturesAvailable = Result.isOk(audioFeaturesResult);
	const audioFeaturesMap = audioFeaturesAvailable
		? audioFeaturesResult.value
		: new Map<string, AudioFeature>();

	const genresMap = new Map<string, string[]>();
	if (Result.isOk(songsResult)) {
		for (const s of songsResult.value) {
			if (s.genres && s.genres.length > 0) {
				genresMap.set(s.id, s.genres);
			}
		}
	}

	const skippedConfirmedInputsMissing: string[] = [];
	const skippedUnconfirmedLyrics: string[] = [];
	const skippedUnconfirmedAudio: string[] = [];
	const skippedUnconfirmedBoth: string[] = [];
	const blockedSkipErrors = new Map<string, LyricsPrefetchError>();
	const analyzableSongs: BatchSong[] = [];

	for (const song of songs) {
		const lyricsState = classifyLyricsEvidence(song, lyricsCache);
		const audioState = classifyAudioEvidence(
			song.songId,
			audioFeaturesAvailable,
			audioFeaturesMap,
		);

		if (lyricsState === "present" || audioState === "present") {
			analyzableSongs.push(song);
			continue;
		}

		if (
			lyricsState === "missing_confirmed" &&
			audioState === "missing_confirmed"
		) {
			skippedConfirmedInputsMissing.push(song.songId);
		} else if (
			lyricsState === "missing_unconfirmed" &&
			audioState === "missing_unconfirmed"
		) {
			skippedUnconfirmedBoth.push(song.songId);
			// Capture the underlying lyrics prefetch error for the blocked-skip
			// failure row (§7.1). Only the lyrics error is available here; audio
			// unavailability is a pipeline-level condition with no per-song error.
			const cacheEntry = lyricsCache.get(song.songId);
			if (cacheEntry?.error) {
				blockedSkipErrors.set(song.songId, cacheEntry.error);
			}
		} else if (lyricsState === "missing_unconfirmed") {
			skippedUnconfirmedLyrics.push(song.songId);
			const cacheEntry = lyricsCache.get(song.songId);
			if (cacheEntry?.error) {
				blockedSkipErrors.set(song.songId, cacheEntry.error);
			}
		} else {
			// audio missing_unconfirmed, lyrics missing_confirmed — no per-song
			// lyrics error to thread (the lyrics provider gave a definitive answer).
			skippedUnconfirmedAudio.push(song.songId);
		}
	}

	const analyzedSongIds: string[] = [];
	const failedSongIds: string[] = [];
	const retryCandidateSongIds: string[] = [];
	const failureClassifications = new Map<
		string,
		AnalysisFailureClassification
	>();

	const chunks = chunkArray(analyzableSongs, deps.concurrency);
	for (const chunk of chunks) {
		const results = await Promise.all(
			chunk.map(async (song) => {
				const cachedEntry = lyricsCache.get(song.songId);
				const lyrics = cachedEntry?.lyrics ?? song.lyrics;
				const af = audioFeaturesMap.get(song.songId) ?? null;

				const input: AnalyzeSongInput = {
					songId: song.songId,
					artist: song.artist,
					title: song.title,
					lyrics,
					audioFeatures: af,
					genres: genresMap.get(song.songId),
					instrumentalness: af?.instrumentalness ?? undefined,
					// Thread the fetch outcome into the classifier so step 1
					// (confirmed-instrumental) fires when appropriate.
					fetchOutcome: cachedEntry?.outcome,
				};

				const result = await deps.songAnalysisService.analyzeSong(input);
				return { songId: song.songId, result };
			}),
		);

		for (const { songId, result } of results) {
			if (Result.isOk(result)) {
				if (isRetryCandidate(result.value)) {
					// Unknown content type: no analysis written; song should be
					// re-selected once better data is available (§5.3).
					retryCandidateSongIds.push(songId);
				} else {
					analyzedSongIds.push(songId);
				}
			} else {
				failedSongIds.push(songId);
				failureClassifications.set(
					songId,
					classifyAnalysisFailure(result.error),
				);
			}
		}
	}

	return {
		analyzedSongIds,
		failedSongIds,
		failureClassifications,
		skippedConfirmedInputsMissing,
		skippedUnconfirmedLyrics,
		skippedUnconfirmedAudio,
		skippedUnconfirmedBoth,
		retryCandidateSongIds,
		blockedSkipErrors,
	};
}

export function createSongBatchAnalyzerDeps(
	config?: BatchAnalysisConfig,
): Result<SongBatchAnalyzerDeps, PipelineConfigError> {
	const provider = config?.provider ?? "google-vertex";
	const concurrency = config?.concurrency ?? 5;

	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
		return Result.err(
			new PipelineConfigError(
				"Concurrency must be an integer between 1 and 10.",
				provider,
			),
		);
	}

	const llmConfig = resolveLlmConfig(provider);
	if (!llmConfig.ok) {
		return Result.err(new PipelineConfigError(llmConfig.reason, provider));
	}

	const geniusToken = env.GENIUS_CLIENT_TOKEN;
	const lyricsService = geniusToken
		? new LyricsService({ accessToken: geniusToken }, createLrclibProvider())
		: null;

	const llm = new LlmService(llmConfig.config);
	const songAnalysisService = new SongAnalysisService(llm);

	return Result.ok({ lyricsService, songAnalysisService, concurrency });
}

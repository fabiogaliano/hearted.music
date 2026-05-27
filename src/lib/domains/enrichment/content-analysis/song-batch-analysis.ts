import { Result } from "better-result";
import type { AudioFeature } from "@/lib/domains/enrichment/audio-features/queries";
import { getBatch as getAudioFeaturesBatch } from "@/lib/domains/enrichment/audio-features/queries";
import { getByIds as getSongsByIds } from "@/lib/domains/library/songs/queries";
import { getApiKeyForProvider } from "@/lib/integrations/llm/config";
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
import { LyricsService } from "../lyrics/service";
import {
	type AnalysisFailureClassification,
	classifyAnalysisFailure,
} from "./failure-classification";
import type { AnalyzeSongInput } from "./song-analysis";
import { SongAnalysisService } from "./song-analysis";

export interface BatchSong {
	songId: string;
	artist: string;
	title: string;
	lyrics: string;
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
}

export interface BatchAnalysisConfig {
	concurrency?: number;
	provider?: "google" | "anthropic" | "openai";
}

type InputEvidence = "present" | "missing_confirmed" | "missing_unconfirmed";

type LyricsPrefetchError =
	| GeniusError
	| NoLyricsAvailableError
	| PipelineConfigError;

interface LyricsCacheEntry {
	lyrics: string | null;
	error?: LyricsPrefetchError;
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

function toLyricsPrefetchError(
	error: GeniusError,
	song: BatchSong,
): LyricsPrefetchError {
	if (error instanceof GeniusNotFoundError) {
		return new NoLyricsAvailableError(
			song.songId,
			song.artist,
			song.title,
			error,
		);
	}
	return error;
}

function classifyLyricsEvidence(
	song: BatchSong,
	cache: LyricsCache,
): InputEvidence {
	if (song.lyrics && song.lyrics.trim().length > 0) return "present";

	const entry = cache.get(song.songId);
	if (!entry) return "missing_unconfirmed";

	if (entry.lyrics !== null && entry.lyrics.trim().length > 0) return "present";

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
				const lyricsResult = await lyricsService.fetchAndStoreLyrics(
					song.songId,
					song.artist,
					song.title,
				);
				if (Result.isOk(lyricsResult)) {
					cache.set(song.songId, { lyrics: lyricsResult.value });
				} else {
					cache.set(song.songId, {
						lyrics: null,
						error: toLyricsPrefetchError(lyricsResult.error, song),
					});
				}
			} catch (error) {
				const prefetchError = isGeniusError(error)
					? toLyricsPrefetchError(error, song)
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
		} else if (lyricsState === "missing_unconfirmed") {
			skippedUnconfirmedLyrics.push(song.songId);
		} else {
			skippedUnconfirmedAudio.push(song.songId);
		}
	}

	const analyzedSongIds: string[] = [];
	const failedSongIds: string[] = [];
	const failureClassifications = new Map<
		string,
		AnalysisFailureClassification
	>();

	const chunks = chunkArray(analyzableSongs, deps.concurrency);
	for (const chunk of chunks) {
		const results = await Promise.all(
			chunk.map(async (song) => {
				const cachedLyrics = lyricsCache.get(song.songId);
				const lyrics = cachedLyrics?.lyrics ?? song.lyrics;
				const af = audioFeaturesMap.get(song.songId) ?? null;

				const input: AnalyzeSongInput = {
					songId: song.songId,
					artist: song.artist,
					title: song.title,
					lyrics,
					audioFeatures: af,
					genres: genresMap.get(song.songId),
					instrumentalness: af?.instrumentalness ?? undefined,
				};

				const result = await deps.songAnalysisService.analyzeSong(input);
				return { songId: song.songId, result };
			}),
		);

		for (const { songId, result } of results) {
			if (Result.isOk(result)) {
				analyzedSongIds.push(songId);
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
	};
}

export function createSongBatchAnalyzerDeps(
	config?: BatchAnalysisConfig,
): Result<SongBatchAnalyzerDeps, PipelineConfigError> {
	const provider = config?.provider ?? "google";
	const concurrency = config?.concurrency ?? 5;

	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
		return Result.err(
			new PipelineConfigError(
				"Concurrency must be an integer between 1 and 10.",
				provider,
			),
		);
	}

	const llmApiKey = getApiKeyForProvider(provider);
	if (!llmApiKey || llmApiKey.trim() === "") {
		return Result.err(
			new PipelineConfigError(
				"Missing API key. Please set the required environment variable.",
				provider,
			),
		);
	}

	const geniusToken = process.env.GENIUS_CLIENT_TOKEN;
	const lyricsService = geniusToken
		? new LyricsService({ accessToken: geniusToken })
		: null;

	const llm = new LlmService({ provider, apiKey: llmApiKey });
	const songAnalysisService = new SongAnalysisService(llm);

	return Result.ok({ lyricsService, songAnalysisService, concurrency });
}

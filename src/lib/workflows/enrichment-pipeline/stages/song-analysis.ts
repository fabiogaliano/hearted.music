import { Result } from "better-result";
import {
	type AudioFeature,
	getBatch as getAudioFeaturesBatch,
} from "@/lib/domains/enrichment/audio-features/queries";
import { classifyAnalysisFailure } from "@/lib/domains/enrichment/content-analysis/failure-classification";
import { get } from "@/lib/domains/enrichment/content-analysis/queries";
import type { AnalyzeSongInput } from "@/lib/domains/enrichment/content-analysis/song-analysis";
import {
	analyzeSongBatch,
	type BatchAnalysisOutcome,
	type BatchSong,
	createSongBatchAnalyzerDeps,
	type LyricsPrefetchError,
	type SongBatchAnalyzerDeps,
} from "@/lib/domains/enrichment/content-analysis/song-batch-analysis";
import {
	getLatestLyricsSnapshots,
	type LatestLyricsSnapshot,
} from "@/lib/domains/enrichment/lyrics/queries";
import { GeniusFetchError } from "@/lib/shared/errors/external/genius";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import type { StageFailure, StageOutcome } from "../stage-outcomes";
import type { EnrichmentContext } from "../types";

const STAGE = "song_analysis" as const;

interface SongAnalysisReadiness {
	newSongIds: string[];
	reanalyzeSongIds: string[];
	probeSongIds: string[];
	snapshots: Map<string, LatestLyricsSnapshot>;
}

interface ProbeOutcome {
	succeededSongIds: string[];
	failures: StageFailure[];
}

/**
 * Extract observable error detail from a lyrics prefetch error so blocked-skip
 * failure rows carry the real cause (error class, HTTP status, URL) instead of
 * a canned provider-unavailable message (§7.1).
 */
function blockedSkipErrorDetail(
	error: LyricsPrefetchError | undefined,
	fallbackMessage: string,
): Pick<StageFailure, "message" | "provider" | "statusCode" | "causeTag"> {
	if (!error) return { message: fallbackMessage };

	if (error instanceof GeniusFetchError) {
		return {
			message: `GeniusFetchError: ${error.message} — ${error.url}`,
			provider: "genius",
			statusCode: error.statusCode,
			causeTag: "fetch_error",
		};
	}

	// GeniusConfigError, GeniusNotFoundError, NoLyricsAvailableError,
	// PipelineConfigError, or LrclibError wrapped in PipelineConfigError.
	return { message: error.message };
}

function retryCandidateFailure(songId: string): StageFailure {
	return {
		songId,
		failureCode: FAILURE_CODES.ANALYSIS_RETRY_CANDIDATE,
		message:
			"Analysis deferred: no authoritative lyrics or instrumental signal yet",
	};
}

function classifiedFailure(songId: string, error: unknown): StageFailure {
	const classification = classifyAnalysisFailure(error);
	const isRetryable = classification.isRetryable;

	return {
		songId,
		failureCode: isRetryable
			? FAILURE_CODES.PROVIDER_TRANSIENT
			: FAILURE_CODES.PERMANENT,
		message:
			classification.message ??
			(isRetryable
				? "Song analysis failed (transient — will retry)"
				: "Song analysis failed"),
		retryAfterMs: classification.retryAfterMs,
		provider: classification.provider,
		statusCode: classification.statusCode,
		causeTag: classification.cause,
	};
}

function batchFailure(
	songId: string,
	outcome: BatchAnalysisOutcome,
): StageFailure {
	const classification = outcome.failureClassifications.get(songId);
	if (!classification) {
		return {
			songId,
			failureCode: FAILURE_CODES.PERMANENT,
			message: "Song analysis failed",
		};
	}

	return {
		songId,
		failureCode: classification.isRetryable
			? FAILURE_CODES.PROVIDER_TRANSIENT
			: FAILURE_CODES.PERMANENT,
		message: classification.message,
		retryAfterMs: classification.retryAfterMs,
		provider: classification.provider,
		statusCode: classification.statusCode,
		causeTag: classification.cause,
	};
}

async function getReadyForSongAnalysis(
	batchSongIds: string[],
): Promise<SongAnalysisReadiness> {
	const [existingResult, lyricsResult] = await Promise.all([
		get(batchSongIds),
		getLatestLyricsSnapshots(batchSongIds),
	]);
	if (Result.isError(existingResult)) {
		throw new Error(
			`Failed to check existing analyses: ${existingResult.error.message}`,
		);
	}
	if (Result.isError(lyricsResult)) {
		throw new Error(
			`Failed to check latest lyrics snapshots: ${lyricsResult.error.message}`,
		);
	}

	const existingMap = existingResult.value;
	const snapshots = lyricsResult.value;
	const newSongIds: string[] = [];
	const reanalyzeSongIds: string[] = [];
	const probeSongIds: string[] = [];

	for (const songId of batchSongIds) {
		const analysis = existingMap.get(songId);
		const snapshot = snapshots.get(songId);

		if (!analysis) {
			newSongIds.push(songId);
			continue;
		}

		if (
			snapshot?.latestLyricsUpdatedAt !== null &&
			snapshot?.latestLyricsUpdatedAt !== undefined &&
			snapshot.latestLyricsUpdatedAt > analysis.created_at
		) {
			reanalyzeSongIds.push(songId);
			continue;
		}

		if (
			snapshot?.latestLyricsUpdatedAt == null &&
			(snapshot?.latestFetchStatus === null ||
				snapshot?.latestFetchStatus === "not_found")
		) {
			probeSongIds.push(songId);
		}
	}

	return { newSongIds, reanalyzeSongIds, probeSongIds, snapshots };
}

function buildBatchSongs(
	ids: string[],
	batch: PipelineBatch,
	snapshots: Map<string, LatestLyricsSnapshot>,
): BatchSong[] {
	const songMap = new Map(batch.songs.map((song) => [song.id, song]));

	return ids.map((id) => {
		const song = songMap.get(id);
		return {
			songId: id,
			artist: song?.artists[0] ?? "Unknown Artist",
			title: song?.name ?? "Unknown",
			lyrics: snapshots.get(id)?.latestLyricsText ?? "",
			albumName: song?.album_name ?? undefined,
			durationSec:
				song?.duration_ms != null
					? Math.round(song.duration_ms / 1000)
					: undefined,
		};
	});
}

async function resolveBatchOutcome(
	attemptedSongIds: string[],
	batchOutcome: BatchAnalysisOutcome,
): Promise<{ succeededSongIds: string[]; failures: StageFailure[] }> {
	const {
		failedSongIds,
		skippedConfirmedInputsMissing,
		skippedUnconfirmedLyrics,
		skippedUnconfirmedAudio,
		skippedUnconfirmedBoth,
		retryCandidateSongIds,
		blockedSkipErrors,
	} = batchOutcome;

	if (retryCandidateSongIds.length > 0) {
		console.info(
			`[SongAnalysis] ${retryCandidateSongIds.length} song(s) classified unknown (retry candidates): ${retryCandidateSongIds.join(", ")}`,
		);
	}

	const skippedSet = new Set<string>([
		...skippedConfirmedInputsMissing,
		...skippedUnconfirmedLyrics,
		...skippedUnconfirmedAudio,
		...skippedUnconfirmedBoth,
		...retryCandidateSongIds,
	]);

	let failures: StageFailure[] = [];

	for (const songId of skippedConfirmedInputsMissing) {
		failures.push({
			songId,
			failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
			message: "Analysis skipped: neither lyrics nor audio features available",
		});
	}

	for (const songId of skippedUnconfirmedLyrics) {
		const errorDetail = blockedSkipErrorDetail(
			blockedSkipErrors.get(songId),
			"Analysis skipped: audio confirmed missing, lyrics provider unavailable",
		);
		failures.push({
			songId,
			failureCode: FAILURE_CODES.ANALYSIS_BLOCKED_LYRICS_UNAVAILABLE,
			...errorDetail,
		});
	}

	for (const songId of skippedUnconfirmedAudio) {
		failures.push({
			songId,
			failureCode: FAILURE_CODES.ANALYSIS_BLOCKED_AUDIO_UNAVAILABLE,
			message:
				"Analysis skipped: lyrics confirmed missing, audio provider unavailable",
		});
	}

	for (const songId of skippedUnconfirmedBoth) {
		const errorDetail = blockedSkipErrorDetail(
			blockedSkipErrors.get(songId),
			"Analysis skipped: lyrics and audio providers both unavailable",
		);
		failures.push({
			songId,
			failureCode: FAILURE_CODES.ANALYSIS_BLOCKED_BOTH_UNAVAILABLE,
			...errorDetail,
		});
	}

	for (const songId of retryCandidateSongIds) {
		failures.push(retryCandidateFailure(songId));
	}

	const postRunCheck = await get(attemptedSongIds);
	if (Result.isError(postRunCheck)) {
		const uncertainSongIds = attemptedSongIds.filter(
			(id) => !skippedSet.has(id),
		);
		for (const songId of uncertainSongIds) {
			failures.push({
				songId,
				failureCode: FAILURE_CODES.ANALYSIS_POSTRUN_LOOKUP_UNAVAILABLE,
				message: `Post-run analysis lookup failed; classification deferred: ${postRunCheck.error.message}`,
			});
		}
		return { succeededSongIds: [], failures };
	}

	const analyzedSet = postRunCheck.value;
	const succeededSongIds = attemptedSongIds.filter((id) => analyzedSet.has(id));
	failures = failures.filter((failure) => !analyzedSet.has(failure.songId));

	const genuinelyFailed = failedSongIds.filter(
		(id) => !skippedSet.has(id) && !analyzedSet.has(id),
	);
	for (const songId of genuinelyFailed) {
		failures.push(batchFailure(songId, batchOutcome));
	}

	return { succeededSongIds, failures };
}

async function probeLyricsRefreshCandidates(
	batch: PipelineBatch,
	probeSongIds: string[],
	deps: SongBatchAnalyzerDeps,
): Promise<ProbeOutcome> {
	if (probeSongIds.length === 0) {
		return { succeededSongIds: [], failures: [] };
	}

	const songMap = new Map(batch.songs.map((song) => [song.id, song]));
	const audioFeaturesResult = await getAudioFeaturesBatch(probeSongIds);
	const audioFeatures: Map<string, AudioFeature> = Result.isOk(
		audioFeaturesResult,
	)
		? audioFeaturesResult.value
		: new Map<string, AudioFeature>();

	const failures: StageFailure[] = [];
	const succeededSongIds: string[] = [];

	for (const songId of probeSongIds) {
		const song = songMap.get(songId);
		if (!song) {
			failures.push({
				songId,
				failureCode: FAILURE_CODES.PERMANENT,
				message: "Song analysis refresh candidate could not be loaded",
			});
			continue;
		}

		if (deps.lyricsService === null) {
			failures.push({
				songId,
				failureCode: FAILURE_CODES.PROVIDER_UNAVAILABLE,
				message: "Lyrics refresh unavailable: lyrics service is not configured",
			});
			continue;
		}

		const outcomeResult = await deps.lyricsService.fetchAndStoreOutcome({
			songId,
			artist: song.artists[0] ?? "Unknown Artist",
			song: song.name,
			albumName: song.album_name ?? undefined,
			durationMs: song.duration_ms ?? undefined,
		});
		if (Result.isError(outcomeResult)) {
			failures.push({
				songId,
				failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
				message: `Lyrics refresh failed: ${outcomeResult.error.message}`,
			});
			continue;
		}

		const fetchOutcome = outcomeResult.value;
		if (fetchOutcome.kind === "not_found") {
			failures.push({
				songId,
				failureCode: FAILURE_CODES.ANALYSIS_LYRICS_REFRESH_PENDING,
				message: "Lyrics still unavailable; will retry later",
			});
			continue;
		}

		const audioFeature = audioFeatures.get(songId) ?? null;
		const input: AnalyzeSongInput = {
			songId,
			artist: song.artists[0] ?? "Unknown Artist",
			title: song.name,
			lyrics: fetchOutcome.kind === "lyrics" ? fetchOutcome.text : null,
			audioFeatures: audioFeature,
			genres: song.genres ?? undefined,
			instrumentalness: audioFeature?.instrumentalness ?? undefined,
			fetchOutcome,
			ignoreExistingAnalysis: true,
		};

		const analyzeResult = await deps.songAnalysisService.analyzeSong(input);
		if (Result.isError(analyzeResult)) {
			failures.push(classifiedFailure(songId, analyzeResult.error));
			continue;
		}
		if (
			"kind" in analyzeResult.value &&
			analyzeResult.value.kind === "retry_candidate"
		) {
			failures.push(retryCandidateFailure(songId));
			continue;
		}

		succeededSongIds.push(songId);
	}

	return { succeededSongIds, failures };
}

export async function runSongAnalysis(
	_ctx: EnrichmentContext,
	batch: PipelineBatch,
): Promise<StageOutcome> {
	const readiness = await getReadyForSongAnalysis(batch.songIds);
	const analysisSongIds = [
		...readiness.newSongIds,
		...readiness.reanalyzeSongIds,
	];
	const attemptedSongIds = batch.songIds.filter(
		(id) => analysisSongIds.includes(id) || readiness.probeSongIds.includes(id),
	);

	if (attemptedSongIds.length === 0) {
		return { kind: "skipped", stage: STAGE, candidateSongIds: batch.songIds };
	}

	const depsResult = createSongBatchAnalyzerDeps();
	if (Result.isError(depsResult)) {
		return {
			kind: "attempted",
			stage: STAGE,
			candidateSongIds: batch.songIds,
			attemptedSongIds,
			succeededSongIds: [],
			failures: attemptedSongIds.map((songId) => ({
				songId,
				failureCode: FAILURE_CODES.PROVIDER_UNAVAILABLE,
				message: `Analysis pipeline config unavailable: ${depsResult.error.message}`,
			})),
		};
	}

	const deps = depsResult.value;
	let succeededSongIds: string[] = [];
	let failures: StageFailure[] = [];

	if (analysisSongIds.length > 0) {
		const songsToAnalyze = buildBatchSongs(
			analysisSongIds,
			batch,
			readiness.snapshots,
		);
		const batchOutcome = await analyzeSongBatch(songsToAnalyze, deps, {
			forceAnalyzeSongIds: new Set(readiness.reanalyzeSongIds),
		});
		const resolved = await resolveBatchOutcome(analysisSongIds, batchOutcome);
		succeededSongIds = [...succeededSongIds, ...resolved.succeededSongIds];
		failures = [...failures, ...resolved.failures];
	}

	if (readiness.probeSongIds.length > 0) {
		const probeOutcome = await probeLyricsRefreshCandidates(
			batch,
			readiness.probeSongIds,
			deps,
		);
		succeededSongIds = [...succeededSongIds, ...probeOutcome.succeededSongIds];
		failures = [...failures, ...probeOutcome.failures];
	}

	return {
		kind: "attempted",
		stage: STAGE,
		candidateSongIds: batch.songIds,
		attemptedSongIds,
		succeededSongIds,
		failures,
	};
}

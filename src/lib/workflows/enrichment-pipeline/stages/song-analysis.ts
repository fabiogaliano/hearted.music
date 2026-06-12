import { Result } from "better-result";
import { get } from "@/lib/domains/enrichment/content-analysis/queries";
import {
	analyzeSongBatch,
	type BatchAnalysisOutcome,
	type BatchSong,
	createSongBatchAnalyzerDeps,
	type LyricsPrefetchError,
} from "@/lib/domains/enrichment/content-analysis/song-batch-analysis";
import {
	GeniusFetchError,
	GeniusParseError,
} from "@/lib/shared/errors/external/genius";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import type { StageFailure, StageOutcome } from "../stage-outcomes";
import type { EnrichmentContext, ReadyResult } from "../types";

const STAGE = "song_analysis" as const;

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

	if (error instanceof GeniusParseError) {
		return {
			message: `GeniusParseError: ${error.reason} — ${error.url}`,
			provider: "genius",
			causeTag: "parse_error",
		};
	}

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

/**
 * Map a batch failure onto a stage failure, preserving retry metadata
 * (Retry-After floor, provider, status, cause) instead of flattening to a bare
 * message. Retryable verdicts become a transient code (policy backs off and
 * retries); everything else is permanent.
 */
function toStageFailure(
	songId: string,
	outcome: BatchAnalysisOutcome,
): StageFailure {
	const classification = outcome.failureClassifications.get(songId);
	const isRetryable = classification?.isRetryable ?? false;

	return {
		songId,
		failureCode: isRetryable
			? FAILURE_CODES.PROVIDER_TRANSIENT
			: FAILURE_CODES.PERMANENT,
		message:
			classification?.message ??
			(isRetryable
				? "Song analysis failed (transient — will retry)"
				: "Song analysis failed"),
		retryAfterMs: classification?.retryAfterMs,
		provider: classification?.provider,
		statusCode: classification?.statusCode,
		causeTag: classification?.cause,
	};
}

async function getReadyForSongAnalysis(
	batchSongIds: string[],
): Promise<ReadyResult> {
	const existingResult = await get(batchSongIds);
	if (Result.isError(existingResult)) {
		throw new Error(
			`Failed to check existing analyses: ${existingResult.error.message}`,
		);
	}

	const existingMap = existingResult.value as Map<string, unknown>;
	const ready: string[] = [];
	const done: string[] = [];
	for (const id of batchSongIds) {
		if (existingMap.has(id)) {
			done.push(id);
		} else {
			ready.push(id);
		}
	}

	return { ready, notReady: [], done };
}

export async function runSongAnalysis(
	_ctx: EnrichmentContext,
	batch: PipelineBatch,
): Promise<StageOutcome> {
	const readiness = await getReadyForSongAnalysis(batch.songIds);

	if (readiness.ready.length === 0) {
		return { kind: "skipped", stage: STAGE, candidateSongIds: batch.songIds };
	}

	const depsResult = createSongBatchAnalyzerDeps();
	if (Result.isError(depsResult)) {
		return {
			kind: "attempted",
			stage: STAGE,
			candidateSongIds: batch.songIds,
			attemptedSongIds: readiness.ready,
			succeededSongIds: [],
			failures: readiness.ready.map((songId) => ({
				songId,
				failureCode: FAILURE_CODES.PROVIDER_UNAVAILABLE,
				message: `Analysis pipeline config unavailable: ${depsResult.error.message}`,
			})),
		};
	}

	const songMap = new Map(batch.songs.map((s) => [s.id, s]));
	const songsToAnalyze: BatchSong[] = readiness.ready.map((id) => {
		const song = songMap.get(id);
		return {
			songId: id,
			artist: song?.artists[0] ?? "Unknown Artist",
			title: song?.name ?? "Unknown",
			lyrics: "",
			albumName: song?.album_name ?? undefined,
			// Convert ms to seconds for the LRCLIB ±2s duration matching window.
			durationSec:
				song?.duration_ms != null
					? Math.round(song.duration_ms / 1000)
					: undefined,
		};
	});

	const batchOutcome = await analyzeSongBatch(songsToAnalyze, depsResult.value);

	const {
		failedSongIds,
		skippedConfirmedInputsMissing,
		skippedUnconfirmedLyrics,
		skippedUnconfirmedAudio,
		skippedUnconfirmedBoth,
		retryCandidateSongIds,
		blockedSkipErrors,
	} = batchOutcome;

	// Retry candidates are songs whose classifier found no authoritative signal
	// (unknown). They are NOT failures: no analysis row was written, and the song
	// remains selectable once better data arrives (§5.3 / §6.2). Log them so the
	// worker run is observable without recording a failure row.
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
		// Retry candidates are excluded from failure accounting; they are also
		// excluded from succeededSongIds (post-run check handles that naturally
		// since no analysis row was written).
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
			// Audio unavailability is a pipeline-level condition — no per-song
			// provider error is available, only the canned message.
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

	// Post-run check: which ready songs now have an analysis. A terminal
	// `permanent` verdict needs this state, so if the lookup fails we mark
	// uncertain songs retryable rather than permanently blocking them.
	const postRunCheck = await get(readiness.ready);

	if (Result.isError(postRunCheck)) {
		const uncertainSongIds = readiness.ready.filter(
			(id) => !skippedSet.has(id),
		);
		for (const songId of uncertainSongIds) {
			failures.push({
				songId,
				failureCode: FAILURE_CODES.ANALYSIS_POSTRUN_LOOKUP_UNAVAILABLE,
				message: `Post-run analysis lookup failed; classification deferred: ${postRunCheck.error.message}`,
			});
		}

		return {
			kind: "attempted",
			stage: STAGE,
			candidateSongIds: batch.songIds,
			attemptedSongIds: readiness.ready,
			succeededSongIds: [],
			failures,
		};
	}

	const analyzedSet = postRunCheck.value as Map<string, unknown>;
	const succeededSongIds = readiness.ready.filter((id) => analyzedSet.has(id));
	failures = failures.filter((failure) => !analyzedSet.has(failure.songId));

	// Reported failed by the analyzer, not in any skip bucket, and not confirmed
	// analyzed by the post-run check.
	const genuinelyFailed = failedSongIds.filter(
		(id) => !skippedSet.has(id) && !analyzedSet.has(id),
	);
	for (const songId of genuinelyFailed) {
		failures.push(toStageFailure(songId, batchOutcome));
	}

	return {
		kind: "attempted",
		stage: STAGE,
		candidateSongIds: batch.songIds,
		attemptedSongIds: readiness.ready,
		succeededSongIds,
		failures,
	};
}

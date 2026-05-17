import { Result } from "better-result";
import { get } from "@/lib/domains/enrichment/content-analysis/queries";
import {
	analyzeSongBatch,
	createSongBatchAnalyzerDeps,
	type BatchSong,
} from "@/lib/domains/enrichment/content-analysis/song-batch-analysis";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import type { StageFailure, StageOutcome } from "../stage-outcomes";
import type { EnrichmentContext, ReadyResult } from "../types";

const STAGE = "song_analysis" as const;

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
				failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
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
		};
	});

	const batchOutcome = await analyzeSongBatch(songsToAnalyze, depsResult.value);

	const {
		failedSongIds,
		skippedConfirmedInputsMissing,
		skippedUnconfirmedLyrics,
		skippedUnconfirmedAudio,
		skippedUnconfirmedBoth,
	} = batchOutcome;

	const skippedSet = new Set<string>([
		...skippedConfirmedInputsMissing,
		...skippedUnconfirmedLyrics,
		...skippedUnconfirmedAudio,
		...skippedUnconfirmedBoth,
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
		failures.push({
			songId,
			failureCode: FAILURE_CODES.ANALYSIS_BLOCKED_LYRICS_UNAVAILABLE,
			message:
				"Analysis skipped: audio confirmed missing, lyrics provider unavailable",
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
		failures.push({
			songId,
			failureCode: FAILURE_CODES.ANALYSIS_BLOCKED_BOTH_UNAVAILABLE,
			message: "Analysis skipped: lyrics and audio providers both unavailable",
		});
	}

	// Post-run verification: check which ready songs now have an analysis.
	// Terminal `permanent` classification requires knowing the post-run state.
	// If the lookup fails we classify uncertain songs with a retryable code
	// rather than permanently blocking them.
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

	// Songs that aren't in any skip bucket, weren't confirmed analyzed by the
	// post-run check, AND were reported as failed by the batch analyzer.
	const genuinelyFailed = failedSongIds.filter(
		(id) => !skippedSet.has(id) && !analyzedSet.has(id),
	);
	for (const songId of genuinelyFailed) {
		failures.push({
			songId,
			failureCode: FAILURE_CODES.PERMANENT,
			message: "Song analysis failed",
		});
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

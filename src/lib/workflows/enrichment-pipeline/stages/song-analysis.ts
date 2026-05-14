import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { resolveStageFailures } from "@/lib/data/job-failures";
import { grantAnalysisFailureReplacementCredit } from "@/lib/domains/billing/compensation";
import { createAnalysisPipeline } from "@/lib/domains/enrichment/content-analysis/pipeline";
import * as songAnalysisData from "@/lib/domains/enrichment/content-analysis/queries";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import { recordStageFailure } from "../record-failure";
import type { EnrichmentContext, ReadyResult } from "../types";

const STAGE = "song_analysis";

async function getReadyForSongAnalysis(
	batchSongIds: string[],
): Promise<ReadyResult> {
	const existingResult = await songAnalysisData.get(batchSongIds);
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
	ctx: EnrichmentContext,
	batch: PipelineBatch,
): Promise<{ total: number; succeeded: number; failed: number }> {
	let readiness: ReadyResult;
	try {
		readiness = await getReadyForSongAnalysis(batch.songIds);
	} catch {
		return {
			total: batch.songIds.length,
			succeeded: 0,
			failed: batch.songIds.length,
		};
	}

	if (readiness.ready.length === 0) {
		return { total: 0, succeeded: 0, failed: 0 };
	}

	const pipelineResult = createAnalysisPipeline();
	if (Result.isError(pipelineResult)) {
		return {
			total: readiness.ready.length,
			succeeded: 0,
			failed: readiness.ready.length,
		};
	}
	const pipeline = pipelineResult.value;

	const songMap = new Map(batch.songs.map((s) => [s.id, s]));
	const songsToAnalyze = readiness.ready.map((id) => {
		const song = songMap.get(id);
		return {
			songId: id,
			artist: song?.artists[0] ?? "Unknown Artist",
			title: song?.name ?? "Unknown",
			lyrics: "",
		};
	});

	const analyzeResult = await pipeline.analyzeSongs(
		ctx.accountId,
		songsToAnalyze,
	);
	if (Result.isError(analyzeResult)) {
		return {
			total: songsToAnalyze.length,
			succeeded: 0,
			failed: songsToAnalyze.length,
		};
	}

	const {
		skippedConfirmedInputsMissing,
		skippedUnconfirmedLyrics,
		skippedUnconfirmedAudio,
		skippedUnconfirmedBoth,
	} = analyzeResult.value;
	const skippedSet = new Set<string>([
		...skippedConfirmedInputsMissing,
		...skippedUnconfirmedLyrics,
		...skippedUnconfirmedAudio,
		...skippedUnconfirmedBoth,
	]);
	const jobId = ctx.jobId;

	// Look up which ready songs now have an analysis. Both success-resolution
	// and terminal `permanent` classification depend on knowing the post-run
	// state. If the lookup fails we don't know which songs succeeded vs failed,
	// so we must NOT classify any unaccounted-for song as permanently failed —
	// otherwise a transient DB blip becomes a permanent block.
	const postRunCheck = await songAnalysisData.get(readiness.ready);

	if (Result.isError(postRunCheck)) {
		// Songs whose state we genuinely don't know: ready candidates that were
		// not in any skip bucket. Skip-bucket songs already have their own
		// failure rows so excluding them here avoids double-suppression.
		const uncertainSongIds = readiness.ready.filter(
			(id) => !skippedSet.has(id),
		);

		console.warn(
			"[song-analysis] post-run analysis lookup failed; deferring classification with non-terminal suppression",
			{
				accountId: ctx.accountId,
				jobId: jobId ?? null,
				candidateCount: readiness.ready.length,
				skippedCount: skippedSet.size,
				uncertainCount: uncertainSongIds.length,
				failedReported: analyzeResult.value.failed,
				error: postRunCheck.error,
			},
		);

		// Write a durable, queryable signal per uncertain song. The lifecycle
		// suppression (transient backoff) prevents churn while the DB recovers,
		// and the dedicated failure_code makes the condition alertable in
		// dashboards without parsing logs.
		if (jobId && uncertainSongIds.length > 0) {
			await Promise.all(
				uncertainSongIds.map((songId) =>
					recordStageFailure({
						jobId,
						accountId: ctx.accountId,
						songId,
						stage: STAGE,
						failureCode: FAILURE_CODES.ANALYSIS_POSTRUN_LOOKUP_UNAVAILABLE,
						errorMessage: `Post-run analysis lookup failed; classification deferred: ${postRunCheck.error.message}`,
					}),
				),
			);
		}
	} else {
		const analyzedSet = postRunCheck.value as Map<string, unknown>;
		const succeededIds = readiness.ready.filter((id) => analyzedSet.has(id));
		if (succeededIds.length > 0) {
			await Promise.all(
				succeededIds.map((songId) =>
					resolveStageFailures({
						accountId: ctx.accountId,
						itemId: songId,
						stage: STAGE,
					}),
				),
			);
		}
	}

	if (jobId && skippedConfirmedInputsMissing.length > 0) {
		await Promise.all(
			skippedConfirmedInputsMissing.map((songId) =>
				recordStageFailure({
					jobId,
					accountId: ctx.accountId,
					songId,
					stage: STAGE,
					failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
					errorMessage:
						"Analysis skipped: neither lyrics nor audio features available",
				}),
			),
		);

		const compensationClient = createAdminSupabaseClient();
		await Promise.all(
			skippedConfirmedInputsMissing.map(async (songId) => {
				try {
					const outcome = await grantAnalysisFailureReplacementCredit(
						compensationClient,
						{
							accountId: ctx.accountId,
							songId,
							failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
						},
					);
					if (Result.isError(outcome)) {
						console.error(
							"[song-analysis] compensation rpc failed",
							{ accountId: ctx.accountId, songId },
							outcome.error,
						);
					}
				} catch (err) {
					console.error(
						"[song-analysis] compensation threw",
						{ accountId: ctx.accountId, songId },
						err,
					);
				}
			}),
		);
	}

	if (jobId && skippedUnconfirmedLyrics.length > 0) {
		await Promise.all(
			skippedUnconfirmedLyrics.map((songId) =>
				recordStageFailure({
					jobId,
					accountId: ctx.accountId,
					songId,
					stage: STAGE,
					failureCode: FAILURE_CODES.ANALYSIS_BLOCKED_LYRICS_UNAVAILABLE,
					errorMessage:
						"Analysis skipped: audio confirmed missing, lyrics provider unavailable",
				}),
			),
		);
	}

	if (jobId && skippedUnconfirmedAudio.length > 0) {
		await Promise.all(
			skippedUnconfirmedAudio.map((songId) =>
				recordStageFailure({
					jobId,
					accountId: ctx.accountId,
					songId,
					stage: STAGE,
					failureCode: FAILURE_CODES.ANALYSIS_BLOCKED_AUDIO_UNAVAILABLE,
					errorMessage:
						"Analysis skipped: lyrics confirmed missing, audio provider unavailable",
				}),
			),
		);
	}

	if (jobId && skippedUnconfirmedBoth.length > 0) {
		await Promise.all(
			skippedUnconfirmedBoth.map((songId) =>
				recordStageFailure({
					jobId,
					accountId: ctx.accountId,
					songId,
					stage: STAGE,
					failureCode: FAILURE_CODES.ANALYSIS_BLOCKED_BOTH_UNAVAILABLE,
					errorMessage:
						"Analysis skipped: lyrics and audio providers both unavailable",
				}),
			),
		);
	}

	// Terminal permanent classification requires knowing the post-run state.
	// We re-check the Result here (instead of capturing analyzedSet earlier)
	// so the failure path skips this block entirely — see the warning above.
	if (
		jobId &&
		analyzeResult.value.failed > skippedSet.size &&
		Result.isOk(postRunCheck)
	) {
		const analyzedSet = postRunCheck.value as Map<string, unknown>;
		const failedSongIds = readiness.ready.filter(
			(id) => !analyzedSet.has(id) && !skippedSet.has(id),
		);

		await Promise.all(
			failedSongIds.map((songId) =>
				recordStageFailure({
					jobId,
					accountId: ctx.accountId,
					songId,
					stage: STAGE,
					failureCode: FAILURE_CODES.PERMANENT,
					errorMessage: "Song analysis failed",
				}),
			),
		);
	}

	return {
		total: analyzeResult.value.total,
		succeeded: analyzeResult.value.succeeded,
		failed: analyzeResult.value.failed,
	};
}

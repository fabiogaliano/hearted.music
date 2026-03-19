import { Result } from "better-result";
import { createAnalysisPipeline } from "@/lib/domains/enrichment/content-analysis/pipeline";
import * as songAnalysisData from "@/lib/domains/enrichment/content-analysis/queries";
import { recordTerminalFailure } from "@/lib/data/job-failures";
import type { PipelineBatch } from "../batch";
import type { EnrichmentContext, ReadyResult } from "../types";

export async function getReadyForSongAnalysis(
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

	if (analyzeResult.value.failed > 0 && ctx.jobId) {
		const analysisCheck = await songAnalysisData.get(readiness.ready);
		if (Result.isOk(analysisCheck)) {
			const analyzedSet = analysisCheck.value as Map<string, unknown>;
			const failedSongIds = readiness.ready.filter(
				(id) => !analyzedSet.has(id),
			);

			await Promise.all(
				failedSongIds.map((songId) =>
					recordTerminalFailure({
						jobId: ctx.jobId!,
						itemId: songId,
						errorType: "permanent",
						errorMessage: "Song analysis failed",
					}),
				),
			);
		}
	}

	return {
		total: analyzeResult.value.total,
		succeeded: analyzeResult.value.succeeded,
		failed: analyzeResult.value.failed,
	};
}

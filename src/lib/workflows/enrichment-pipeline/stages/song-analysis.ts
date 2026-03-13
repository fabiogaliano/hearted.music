import { Result } from "better-result";
import { createAnalysisPipeline } from "@/lib/domains/enrichment/content-analysis/pipeline";
import * as songAnalysisData from "@/lib/domains/enrichment/content-analysis/queries";
import type { PipelineBatch } from "../batch";
import type {
	EnrichmentContext,
	EnrichmentStageResult,
	ReadyResult,
} from "../types";

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

export async function runSongAnalysisStage(
	ctx: EnrichmentContext,
	batch: PipelineBatch,
): Promise<EnrichmentStageResult> {
	console.log("[pipeline] Stage: song_analysis");

	let readiness: ReadyResult;
	try {
		readiness = await getReadyForSongAnalysis(batch.songIds);
	} catch (error) {
		return {
			stage: "song_analysis",
			status: "failed",
			jobId: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	if (readiness.ready.length === 0) {
		return {
			stage: "song_analysis",
			status: "skipped",
			reason: "no songs need analysis",
		};
	}

	const pipelineResult = createAnalysisPipeline();
	if (Result.isError(pipelineResult)) {
		throw new Error(
			`Failed to create analysis pipeline: ${pipelineResult.error.message}`,
		);
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
		throw new Error(`Song analysis failed: ${analyzeResult.error.message}`);
	}

	const { jobId, succeeded, failed } = analyzeResult.value;
	return {
		stage: "song_analysis",
		status: "completed",
		jobId,
		succeeded,
		failed,
		notReady: readiness.notReady.length,
		done: readiness.done.length,
	};
}

import { Result } from "better-result";
import { createAnalysisPipeline } from "@/lib/capabilities/analysis/pipeline";
import type { EnrichmentContext, EnrichmentStageResult } from "../types";

export async function runSongAnalysisStage(
	ctx: EnrichmentContext,
): Promise<EnrichmentStageResult> {
	console.log("[pipeline] Stage 2: song_analysis");

	const pipelineResult = createAnalysisPipeline();
	if (Result.isError(pipelineResult)) {
		throw new Error(
			`Failed to create analysis pipeline: ${pipelineResult.error.message}`,
		);
	}
	const pipeline = pipelineResult.value;

	const needingResult = await pipeline.getSongsNeedingAnalysis(
		ctx.accountId,
		ctx.maxSongs,
	);
	if (Result.isError(needingResult)) {
		throw new Error(
			`Failed to get songs needing analysis: ${needingResult.error.message}`,
		);
	}

	const batchSet = new Set(ctx.selectedBatchSongIds);
	const songsToAnalyze = needingResult.value.filter((s) =>
		batchSet.has(s.songId),
	);

	if (songsToAnalyze.length === 0) {
		return { stage: "song_analysis", status: "skipped" };
	}

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
	};
}

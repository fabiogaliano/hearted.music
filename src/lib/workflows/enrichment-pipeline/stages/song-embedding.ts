import { Result } from "better-result";
import { runTrackedStageJob } from "../job-runner";
import type { EnrichmentContext, EnrichmentStageResult } from "../types";

export async function runSongEmbeddingStage(
	ctx: EnrichmentContext,
): Promise<EnrichmentStageResult> {
	console.log("[pipeline] Stage 3: song_embedding");

	if (ctx.selectedBatchSongIds.length === 0) {
		return { stage: "song_embedding", status: "skipped" };
	}

	const songIds = ctx.selectedBatchSongIds;

	const { jobId, succeeded, failed } = await runTrackedStageJob({
		accountId: ctx.accountId,
		stage: "song_embedding",
		work: async () => {
			const embedResult = await ctx.embeddingService.embedBatch(songIds);
			if (Result.isOk(embedResult)) {
				return {
					total: songIds.length,
					succeeded: embedResult.value.succeeded.length,
					failed: embedResult.value.failed.length,
					result: undefined,
				};
			}
			return {
				total: songIds.length,
				succeeded: 0,
				failed: songIds.length,
				result: undefined,
			};
		},
	});

	return {
		stage: "song_embedding",
		status: "completed",
		jobId,
		succeeded,
		failed,
	};
}

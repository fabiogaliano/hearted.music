import { Result } from "better-result";
import type { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import * as songAnalysisData from "@/lib/domains/enrichment/content-analysis/queries";
import { runTrackedStageJob } from "../job-runner";
import type { PipelineBatch } from "../batch";
import type {
	EnrichmentContext,
	EnrichmentStageResult,
	ReadyResult,
} from "../types";

export async function getReadyForSongEmbedding(
	batchSongIds: string[],
	embeddingService: EmbeddingService,
): Promise<ReadyResult> {
	const [analysisResult, embeddingsResult] = await Promise.all([
		songAnalysisData.get(batchSongIds),
		embeddingService.getEmbeddings(batchSongIds),
	]);

	if (Result.isError(analysisResult)) {
		throw new Error(
			`Failed to check existing analyses: ${analysisResult.error.message}`,
		);
	}
	if (Result.isError(embeddingsResult)) {
		throw new Error(
			`Failed to check existing embeddings: ${embeddingsResult.error.message}`,
		);
	}

	const analysisMap = analysisResult.value as Map<string, unknown>;
	const embeddingsMap = embeddingsResult.value;

	const ready: string[] = [];
	const notReady: string[] = [];
	const done: string[] = [];

	for (const id of batchSongIds) {
		if (embeddingsMap.has(id)) {
			done.push(id);
		} else if (analysisMap.has(id)) {
			ready.push(id);
		} else {
			notReady.push(id);
		}
	}

	return { ready, notReady, done };
}

export async function runSongEmbeddingStage(
	ctx: EnrichmentContext,
	batch: PipelineBatch,
): Promise<EnrichmentStageResult> {
	console.log("[pipeline] Stage: song_embedding");

	let readiness: ReadyResult;
	try {
		readiness = await getReadyForSongEmbedding(
			batch.songIds,
			ctx.embeddingService,
		);
	} catch (error) {
		return {
			stage: "song_embedding",
			status: "failed",
			jobId: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	if (readiness.ready.length === 0) {
		return {
			stage: "song_embedding",
			status: "skipped",
			reason: "no songs ready for embedding",
		};
	}

	const songIds = readiness.ready;

	const { jobId, succeeded, failed } = await runTrackedStageJob({
		accountId: ctx.accountId,
		stage: "song_embedding",
		work: async () => {
			const embedResult = await ctx.embeddingService.embedBatch(songIds);
			if (Result.isError(embedResult)) {
				console.error("[pipeline] embedBatch error:", embedResult.error);
			}
			if (Result.isOk(embedResult)) {
				if (embedResult.value.failed.length > 0) {
					console.error(
						"[pipeline] embedBatch failed items:",
						embedResult.value.failed,
					);
				}
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
		notReady: readiness.notReady.length,
		done: readiness.done.length,
	};
}

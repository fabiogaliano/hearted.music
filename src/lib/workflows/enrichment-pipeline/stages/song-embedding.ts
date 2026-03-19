import { Result } from "better-result";
import type { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import * as songAnalysisData from "@/lib/domains/enrichment/content-analysis/queries";
import { recordTerminalFailure } from "@/lib/data/job-failures";
import type { PipelineBatch } from "../batch";
import type { EnrichmentContext, ReadyResult } from "../types";

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

export async function runSongEmbedding(
	ctx: EnrichmentContext,
	batch: PipelineBatch,
): Promise<{ total: number; succeeded: number; failed: number }> {
	let readiness: ReadyResult;
	try {
		readiness = await getReadyForSongEmbedding(
			batch.songIds,
			ctx.embeddingService,
		);
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

	const songIds = readiness.ready;
	const embedResult = await ctx.embeddingService.embedBatch(songIds);
	if (Result.isOk(embedResult)) {
		const { failed } = embedResult.value;
		if (failed.length > 0) {
			console.error("[pipeline] embedBatch failed items:", failed);

			if (ctx.jobId) {
				await Promise.all(
					failed.map((item) =>
						recordTerminalFailure({
							jobId: ctx.jobId!,
							itemId: item.songId,
							errorType: item.error.includes("Missing analysis")
								? "validation"
								: "permanent",
							errorMessage: `Embedding failed: ${item.error}`,
						}),
					),
				);
			}
		}
		return {
			total: songIds.length,
			succeeded: embedResult.value.succeeded.length,
			failed: failed.length,
		};
	}
	console.error("[pipeline] embedBatch error:", embedResult.error);
	return { total: songIds.length, succeeded: 0, failed: songIds.length };
}

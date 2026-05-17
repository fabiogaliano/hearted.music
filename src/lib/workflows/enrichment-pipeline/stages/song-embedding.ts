import { Result } from "better-result";
import { get } from "@/lib/domains/enrichment/content-analysis/queries";
import type { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import type { StageFailure, StageOutcome } from "../stage-outcomes";
import type { EnrichmentContext, ReadyResult } from "../types";

const STAGE = "song_embedding" as const;

export async function getReadyForSongEmbedding(
	batchSongIds: string[],
	embeddingService: EmbeddingService,
): Promise<ReadyResult> {
	const [analysisResult, embeddingsResult] = await Promise.all([
		get(batchSongIds),
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
): Promise<StageOutcome> {
	const readiness = await getReadyForSongEmbedding(
		batch.songIds,
		ctx.embeddingService,
	);

	if (readiness.ready.length === 0) {
		return {
			kind: "skipped",
			stage: STAGE,
			candidateSongIds: batch.songIds,
		};
	}

	const songIds = readiness.ready;
	const embedResult = await ctx.embeddingService.embedBatch(songIds);

	if (Result.isOk(embedResult)) {
		const { failed, succeeded } = embedResult.value;

		const succeededSongIds = succeeded.map((item) => item.songId);

		const failures: StageFailure[] = failed.map((item) => ({
			songId: item.songId,
			failureCode: item.error.includes("Missing analysis")
				? FAILURE_CODES.VALIDATION
				: FAILURE_CODES.PERMANENT,
			message: `Embedding failed: ${item.error}`,
		}));

		return {
			kind: "attempted",
			stage: STAGE,
			candidateSongIds: batch.songIds,
			attemptedSongIds: songIds,
			succeededSongIds,
			failures,
		};
	}

	const errorMessage =
		embedResult.error instanceof Error
			? embedResult.error.message
			: String(embedResult.error);

	return {
		kind: "attempted",
		stage: STAGE,
		candidateSongIds: batch.songIds,
		attemptedSongIds: songIds,
		succeededSongIds: [],
		failures: songIds.map((songId) => ({
			songId,
			failureCode: FAILURE_CODES.PERMANENT,
			message: `Embedding failed: ${errorMessage}`,
		})),
	};
}

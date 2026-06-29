import { Result } from "better-result";
import {
	get,
	type SongAnalysis,
} from "@/lib/domains/enrichment/content-analysis/queries";
import type { SongEmbedding } from "@/lib/domains/enrichment/embeddings/queries";
import type { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import type {
	FailureCode,
	StageFailure,
	StageOutcome,
} from "../stage-outcomes";
import type { EnrichmentContext, ReadyResult } from "../types";

const STAGE = "song_embedding" as const;

/**
 * Default to PROVIDER_TRANSIENT so a 5xx/rate-limit/timeout/store blip retries
 * instead of terminalizing the song forever (the prior PERMANENT default did).
 * Only missing-analysis and dimension-mismatch are genuinely unrecoverable.
 */
function classifyEmbeddingFailure(error: string): FailureCode {
	if (error.includes("Missing analysis")) return FAILURE_CODES.VALIDATION;
	if (error.includes("Dimension mismatch")) return FAILURE_CODES.PERMANENT;
	return FAILURE_CODES.PROVIDER_TRANSIENT;
}

/**
 * An embedding is stale when it predates the song's latest analysis — a
 * re-analyzed song (e.g. late lyrics arriving) writes a newer analysis row, so
 * the prior vector no longer reflects the current analysis. Missing timestamps
 * are treated as not-stale: with nothing to compare we leave the embedding be.
 */
function embeddingIsStale(
	embedding: SongEmbedding,
	analysis: SongAnalysis,
): boolean {
	const embeddedAt = Date.parse(embedding.created_at);
	const analyzedAt = Date.parse(analysis.created_at);
	if (Number.isNaN(embeddedAt) || Number.isNaN(analyzedAt)) return false;
	return embeddedAt < analyzedAt;
}

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

	const analysisMap = analysisResult.value;
	const embeddingsMap = embeddingsResult.value;

	const ready: string[] = [];
	const notReady: string[] = [];
	const done: string[] = [];

	for (const id of batchSongIds) {
		const analysis = analysisMap.get(id);
		const embedding = embeddingsMap.get(id);

		if (embedding) {
			// Existence alone is not "done": a stale embedding (older than the
			// latest analysis) must be re-offered so the refreshed analysis embeds.
			if (analysis && embeddingIsStale(embedding, analysis)) {
				ready.push(id);
			} else {
				done.push(id);
			}
		} else if (analysis) {
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
			failureCode: classifyEmbeddingFailure(item.error),
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
			failureCode: classifyEmbeddingFailure(errorMessage),
			message: `Embedding failed: ${errorMessage}`,
		})),
	};
}

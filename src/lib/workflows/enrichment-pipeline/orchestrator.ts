import { Result } from "better-result";
import { getTerminallyFailedSongIds } from "@/lib/data/job-failures";
import { updateJobProgress } from "@/lib/data/jobs";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { markPipelineProcessed } from "@/lib/domains/library/liked-songs/status-queries";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import type { LlmService } from "@/lib/integrations/llm/service";
import { createLlmService } from "@/lib/integrations/llm/service";
import type { EnrichmentChunkProgress } from "@/lib/platform/jobs/progress/types";
import { selectPipelineBatch } from "./batch";
import { makeInitialProgress } from "./progress";
import { runAudioFeatures } from "./stages/audio-features";
import { runGenreTagging } from "./stages/genre-tagging";
import { runSongAnalysis } from "./stages/song-analysis";
import { runSongEmbedding } from "./stages/song-embedding";
import {
	type EnrichmentContext,
	type EnrichmentStageName,
	PipelineBootstrapError,
} from "./types";

type StageResult = { total: number; succeeded: number; failed: number };

function initEmbeddingService(): Result<
	EmbeddingService,
	PipelineBootstrapError
> {
	try {
		return Result.ok(new EmbeddingService());
	} catch (error) {
		return Result.err(
			new PipelineBootstrapError(
				"Failed to initialize EmbeddingService",
				error,
			),
		);
	}
}

function initLlmService(): LlmService | undefined {
	try {
		return createLlmService();
	} catch {
		return undefined;
	}
}

function buildContext(
	accountId: string,
	embeddingService: EmbeddingService,
): EnrichmentContext {
	const llmService = initLlmService();

	return {
		accountId,
		embeddingService,
		profilingService: createPlaylistProfilingService(
			embeddingService,
			llmService,
		),
		llmService,
	};
}

function applyStageResult(
	progress: EnrichmentChunkProgress,
	stageName: EnrichmentStageName,
	result: StageResult,
	status: "completed" | "failed" | "skipped",
): void {
	progress.stages[stageName] = {
		status,
		succeeded: result.succeeded,
		failed: result.failed,
	};
	progress.succeeded += result.succeeded;
	progress.failed += result.failed;
	progress.done += result.succeeded + result.failed;
}

async function persistProgress(
	jobId: string,
	progress: EnrichmentChunkProgress,
): Promise<void> {
	const result = await updateJobProgress(jobId, progress);
	if (Result.isError(result)) {
		console.error(
			`[worker-chunk] Failed to persist progress for job ${jobId}: ${result.error.message}`,
		);
	}
}

async function runStage(
	stageName: EnrichmentStageName,
	fn: () => Promise<StageResult>,
): Promise<StageResult> {
	try {
		return await fn();
	} catch (error) {
		console.error(`[worker-chunk] Stage ${stageName} threw:`, error);
		return { total: 0, succeeded: 0, failed: 0 };
	}
}

function stageStatus(result: StageResult): "completed" | "failed" {
	return result.failed > 0 && result.succeeded === 0 ? "failed" : "completed";
}

// --- Song enrichment phases (A-C) ---

async function enrichSongs(
	ctx: EnrichmentContext,
	batch: Awaited<ReturnType<typeof selectPipelineBatch>>,
	jobId: string,
	progress: EnrichmentChunkProgress,
): Promise<void> {
	// Phase A: audio_features + genre_tagging (parallel)
	progress.currentStage = "audio_features";
	progress.stages.audio_features.status = "running";
	progress.stages.genre_tagging.status = "running";
	await persistProgress(jobId, progress);

	const [audioResult, genreResult] = await Promise.all([
		runStage("audio_features", () => runAudioFeatures(ctx, batch)),
		runStage("genre_tagging", () => runGenreTagging(ctx, batch)),
	]);

	applyStageResult(
		progress,
		"audio_features",
		audioResult,
		stageStatus(audioResult),
	);
	applyStageResult(
		progress,
		"genre_tagging",
		genreResult,
		stageStatus(genreResult),
	);

	// Phase B: song_analysis
	progress.currentStage = "song_analysis";
	progress.stages.song_analysis.status = "running";
	await persistProgress(jobId, progress);

	const analysisResult = await runStage("song_analysis", () =>
		runSongAnalysis(ctx, batch),
	);
	applyStageResult(
		progress,
		"song_analysis",
		analysisResult,
		stageStatus(analysisResult),
	);

	// Phase C: song_embedding
	progress.currentStage = "song_embedding";
	progress.stages.song_embedding.status = "running";
	await persistProgress(jobId, progress);

	const embeddingStageResult = await runStage("song_embedding", () =>
		runSongEmbedding(ctx, batch),
	);
	applyStageResult(
		progress,
		"song_embedding",
		embeddingStageResult,
		stageStatus(embeddingStageResult),
	);
}

// --- Worker-owned chunk orchestration ---

export async function executeWorkerChunk(
	accountId: string,
	jobId: string,
	batchSize: number,
	batchSequence: number,
): Promise<{ hasMoreSongs: boolean }> {
	const embeddingResult = initEmbeddingService();
	if (Result.isError(embeddingResult)) {
		throw new PipelineBootstrapError(
			"Failed to initialize EmbeddingService",
			embeddingResult.error,
		);
	}

	const ctx = { ...buildContext(accountId, embeddingResult.value), jobId };

	const failedIdsResult = await getTerminallyFailedSongIds(accountId);
	const excludeIds = Result.isOk(failedIdsResult) ? failedIdsResult.value : [];

	const batch = await selectPipelineBatch(
		accountId,
		batchSize,
		excludeIds.length > 0 ? excludeIds : undefined,
	);

	const progress = makeInitialProgress(
		batchSize,
		batchSequence,
		batch.songIds.length,
	);

	// Candidate-side enrichment only (phases A-C)
	await enrichSongs(ctx, batch, jobId, progress);

	// Write item_status for ALL batch songs — pipeline processing state only.
	// Snapshot publication is owned by target-playlist refresh, not here.
	if (batch.songIds.length > 0) {
		await markPipelineProcessed(accountId, "song", batch.songIds);
	}

	progress.currentStage = undefined;
	await persistProgress(jobId, progress);

	// Check if more songs still need pipeline processing.
	// This must include songs that already have shared artifacts but still need
	// account-scoped item_status written.
	const probeExcludeIds = excludeIds.length > 0 ? excludeIds : undefined;
	const nextBatch = await selectPipelineBatch(accountId, 1, probeExcludeIds);
	return { hasMoreSongs: nextBatch.songIds.length > 0 };
}

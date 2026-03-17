import { Result } from "better-result";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import { updateJobProgress } from "@/lib/data/jobs";
import { getTerminallyFailedSongIds } from "@/lib/data/job-failures";
import type { EnrichmentChunkProgress } from "@/lib/platform/jobs/progress/types";
import { selectPipelineBatch } from "./batch";
import { runAudioFeatures } from "./stages/audio-features";
import { runGenreTagging } from "./stages/genre-tagging";
import { runSongAnalysis } from "./stages/song-analysis";
import { runSongEmbedding } from "./stages/song-embedding";
import { runPlaylistProfiling } from "./stages/playlist-profiling";
import { runMatching } from "./stages/matching";
import { makeInitialProgress } from "./progress";
import {
	PipelineBootstrapError,
	type EnrichmentContext,
	type EnrichmentStageName,
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

function buildContext(
	accountId: string,
	embeddingService: EmbeddingService,
): EnrichmentContext {
	return {
		accountId,
		embeddingService,
		profilingService: createPlaylistProfilingService(embeddingService),
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

// --- Matching phases (D-E) ---

async function matchSongs(
	ctx: EnrichmentContext,
	batch: Awaited<ReturnType<typeof selectPipelineBatch>>,
	jobId: string,
	progress: EnrichmentChunkProgress,
): Promise<void> {
	// Phase D: playlist_profiling
	progress.currentStage = "playlist_profiling";
	progress.stages.playlist_profiling.status = "running";
	await persistProgress(jobId, progress);

	let profilingPlaylists: Awaited<
		ReturnType<typeof runPlaylistProfiling>
	>["playlists"] = [];
	const profilingResult = await (async (): Promise<StageResult> => {
		try {
			const r = await runPlaylistProfiling(ctx);
			profilingPlaylists = r.playlists;
			return { total: r.total, succeeded: r.succeeded, failed: r.failed };
		} catch (error) {
			console.error("[worker-chunk] Stage playlist_profiling threw:", error);
			return { total: 0, succeeded: 0, failed: 0 };
		}
	})();
	applyStageResult(
		progress,
		"playlist_profiling",
		profilingResult,
		stageStatus(profilingResult),
	);

	// Phase E: matching
	progress.currentStage = "matching";
	progress.stages.matching.status = "running";
	await persistProgress(jobId, progress);

	const matchResult = await runStage("matching", () =>
		runMatching(ctx, batch, profilingPlaylists),
	);
	applyStageResult(progress, "matching", matchResult, stageStatus(matchResult));
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

	await enrichSongs(ctx, batch, jobId, progress);
	await matchSongs(ctx, batch, jobId, progress);

	progress.currentStage = undefined;
	await persistProgress(jobId, progress);

	// Check if there are more unenriched songs
	const nextBatch = await selectPipelineBatch(
		accountId,
		1,
		excludeIds.length > 0 ? excludeIds : undefined,
	);
	return { hasMoreSongs: nextBatch.songIds.length > 0 };
}

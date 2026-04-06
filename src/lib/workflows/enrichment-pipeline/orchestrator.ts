import { Result } from "better-result";
import { updateJobProgress } from "@/lib/data/jobs";
import * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import * as songAnalysisData from "@/lib/domains/enrichment/content-analysis/queries";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { markPipelineProcessed } from "@/lib/domains/library/liked-songs/status-queries";
import * as songData from "@/lib/domains/library/songs/queries";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import type { LlmService } from "@/lib/integrations/llm/service";
import { createLlmService } from "@/lib/integrations/llm/service";
import type { EnrichmentChunkProgress } from "@/lib/platform/jobs/progress/enrichment";
import { maybeDevDelay } from "@/lib/workflows/library-processing/devtools/delay";
import {
	hasMoreSongsNeedingEnrichmentWork,
	loadBatchSongs,
	selectEnrichmentWorkPlan,
	type PipelineBatch,
} from "./batch";
import {
	makeInitialProgress,
	type InitializedEnrichmentChunkProgress,
} from "./progress";
import { runAudioFeatures } from "./stages/audio-features";
import { runGenreTagging } from "./stages/genre-tagging";
import { runSongAnalysis } from "./stages/song-analysis";
import { runContentActivation } from "./stages/content-activation";
import { runSongEmbedding } from "./stages/song-embedding";
import {
	type EnrichmentContext,
	type EnrichmentStageName,
	type EnrichmentWorkPlan,
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
	progress: InitializedEnrichmentChunkProgress,
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
		return { total: 1, succeeded: 0, failed: 1 };
	}
}

function stageStatus(result: StageResult): "completed" | "failed" {
	return result.failed > 0 && result.succeeded === 0 ? "failed" : "completed";
}

function filterBatch(batch: PipelineBatch, songIds: string[]): PipelineBatch {
	const idSet = new Set(songIds);
	return {
		songIds: batch.songIds.filter((id) => idSet.has(id)),
		songs: batch.songs.filter((s) => idSet.has(s.id)),
		spotifyIdBySongId: new Map(
			[...batch.spotifyIdBySongId].filter(([id]) => idSet.has(id)),
		),
	};
}

async function loadDataEnrichedSongIds(
	batch: PipelineBatch,
	embeddingService: EmbeddingService,
	songs = batch.songs,
): Promise<Set<string>> {
	if (batch.songIds.length === 0) {
		return new Set();
	}

	const [audioFeaturesResult, analysisResult, embeddingsResult] =
		await Promise.all([
			audioFeatureData.getBatch(batch.songIds),
			songAnalysisData.get(batch.songIds),
			embeddingService.getEmbeddings(batch.songIds),
		]);

	if (
		Result.isError(audioFeaturesResult) ||
		Result.isError(analysisResult) ||
		Result.isError(embeddingsResult)
	) {
		throw new Error("Failed to resolve data-enriched songs for batch");
	}

	const songById = new Map(songs.map((song) => [song.id, song]));
	const enrichedSongIds = new Set<string>();

	for (const songId of batch.songIds) {
		const song = songById.get(songId);
		if (!song || !song.genres || song.genres.length === 0) {
			continue;
		}

		if (
			audioFeaturesResult.value.has(songId) &&
			analysisResult.value.has(songId) &&
			embeddingsResult.value.has(songId)
		) {
			enrichedSongIds.add(songId);
		}
	}

	return enrichedSongIds;
}

// --- Song enrichment phases (A-C) ---

async function enrichSongs(
	ctx: EnrichmentContext,
	workPlan: EnrichmentWorkPlan,
	batch: PipelineBatch,
	jobId: string,
	progress: InitializedEnrichmentChunkProgress,
	stageDelayMs?: number,
): Promise<void> {
	// Phase A: audio_features + genre_tagging (parallel, unbounded)
	progress.currentStage = "audio_features";
	progress.stages.audio_features.status = "running";
	progress.stages.genre_tagging.status = "running";
	await persistProgress(jobId, progress);

	const audioSubBatch = filterBatch(batch, workPlan.needAudioFeatures);
	const genreSubBatch = filterBatch(batch, workPlan.needGenreTagging);

	const [audioResult, genreResult] = await Promise.all([
		audioSubBatch.songIds.length > 0
			? runStage("audio_features", () => runAudioFeatures(ctx, audioSubBatch))
			: Promise.resolve({ total: 0, succeeded: 0, failed: 0 }),
		genreSubBatch.songIds.length > 0
			? runStage("genre_tagging", () => runGenreTagging(ctx, genreSubBatch))
			: Promise.resolve({ total: 0, succeeded: 0, failed: 0 }),
	]);

	applyStageResult(
		progress,
		"audio_features",
		audioResult,
		audioSubBatch.songIds.length > 0 ? stageStatus(audioResult) : "skipped",
	);
	applyStageResult(
		progress,
		"genre_tagging",
		genreResult,
		genreSubBatch.songIds.length > 0 ? stageStatus(genreResult) : "skipped",
	);

	// Phase B: song_analysis (entitled only)
	await maybeDevDelay(stageDelayMs);
	progress.currentStage = "song_analysis";
	progress.stages.song_analysis.status = "running";
	await persistProgress(jobId, progress);

	const analysisSubBatch = filterBatch(batch, workPlan.needAnalysis);
	const analysisResult =
		analysisSubBatch.songIds.length > 0
			? await runStage("song_analysis", () =>
					runSongAnalysis(ctx, analysisSubBatch),
				)
			: { total: 0, succeeded: 0, failed: 0 };

	applyStageResult(
		progress,
		"song_analysis",
		analysisResult,
		analysisSubBatch.songIds.length > 0
			? stageStatus(analysisResult)
			: "skipped",
	);

	// Phase C: song_embedding (entitled only)
	await maybeDevDelay(stageDelayMs);
	progress.currentStage = "song_embedding";
	progress.stages.song_embedding.status = "running";
	await persistProgress(jobId, progress);

	const embeddingSubBatch = filterBatch(batch, workPlan.needEmbedding);
	const embeddingResult =
		embeddingSubBatch.songIds.length > 0
			? await runStage("song_embedding", () =>
					runSongEmbedding(ctx, embeddingSubBatch),
				)
			: { total: 0, succeeded: 0, failed: 0 };

	applyStageResult(
		progress,
		"song_embedding",
		embeddingResult,
		embeddingSubBatch.songIds.length > 0
			? stageStatus(embeddingResult)
			: "skipped",
	);

	// Content activation: write item_status + persist unlock rows for entitled + analyzed songs
	await runContentActivation(ctx, workPlan.needContentActivation);
}

// --- Worker-owned chunk orchestration ---

export interface ChunkResult {
	hasMoreSongs: boolean;
	newCandidatesAvailable: boolean;
	readyCount: number;
	doneCount: number;
	succeededCount: number;
	failedCount: number;
}

export async function executeWorkerChunk(
	accountId: string,
	jobId: string,
	batchSize: number,
	batchSequence: number,
	stageDelayMs?: number,
): Promise<ChunkResult> {
	const embeddingResult = initEmbeddingService();
	if (Result.isError(embeddingResult)) {
		throw new PipelineBootstrapError(
			"Failed to initialize EmbeddingService",
			embeddingResult.error,
		);
	}

	const ctx = { ...buildContext(accountId, embeddingResult.value), jobId };

	const workPlan = await selectEnrichmentWorkPlan(accountId, batchSize);
	const batch = await loadBatchSongs(workPlan.allSongIds);
	const enrichedBefore = await loadDataEnrichedSongIds(
		batch,
		embeddingResult.value,
	);

	const progress = makeInitialProgress(
		batchSize,
		batchSequence,
		batch.songIds.length,
	);

	// Candidate-side enrichment only (phases A-C)
	await enrichSongs(ctx, workPlan, batch, jobId, progress, stageDelayMs);

	// Write item_status for ALL batch songs — pipeline processing state only.
	if (batch.songIds.length > 0) {
		await markPipelineProcessed(accountId, "song", batch.songIds);
	}

	progress.currentStage = undefined;
	await persistProgress(jobId, progress);

	const songsResult = await songData.getByIds(batch.songIds);
	let newCandidatesAvailable = batch.songIds.length > 0;
	if (Result.isOk(songsResult)) {
		try {
			const enrichedAfter = await loadDataEnrichedSongIds(
				batch,
				embeddingResult.value,
				songsResult.value,
			);
			newCandidatesAvailable = [...enrichedAfter].some(
				(songId) => !enrichedBefore.has(songId),
			);
		} catch {
			// Preserve the prior behavior if post-run readiness checks fail.
			newCandidatesAvailable = batch.songIds.length > 0;
		}
	}

	// Probe whether more songs still need pipeline processing via the DB selector
	const hasMoreSongs = await hasMoreSongsNeedingEnrichmentWork(accountId);

	return {
		hasMoreSongs,
		newCandidatesAvailable,
		readyCount: batch.songIds.length,
		doneCount: progress.done,
		succeededCount: progress.succeeded,
		failedCount: progress.failed,
	};
}

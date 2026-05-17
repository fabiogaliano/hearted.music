import { Result } from "better-result";
import { updateJobProgress } from "@/lib/data/jobs";
import { get as getSongAnalysis } from "@/lib/domains/enrichment/content-analysis/queries";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { getByIds as getSongsByIds } from "@/lib/domains/library/songs/queries";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import type { LlmService } from "@/lib/integrations/llm/service";
import { createLlmService } from "@/lib/integrations/llm/service";
import type { EnrichmentChunkProgress } from "@/lib/platform/jobs/progress/enrichment";
import type { DbError } from "@/lib/shared/errors/database";
import {
	hasMoreSongsNeedingEnrichmentWork,
	loadBatchSongs,
	type PipelineBatch,
	selectEnrichmentWorkPlan,
} from "./batch";
import { FAILURE_CODES } from "./failure-policy";
import {
	type InitializedEnrichmentChunkProgress,
	makeInitialProgress,
} from "./progress";
import {
	type FailureCode,
	finalizeStageOutcome,
	makeThrownOutcome,
	type StageAccountingError,
	type StageOutcome,
	type StageSummary,
} from "./stage-outcomes";
import { runAudioFeatures } from "./stages/audio-features";
import { runContentActivation } from "./stages/content-activation";
import { runGenreTagging } from "./stages/genre-tagging";
import { runSongAnalysis } from "./stages/song-analysis";
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

interface RunStageWithAccountingParams {
	stage: EnrichmentStageName;
	candidateSongIds: string[];
	jobId: string;
	accountId: string;
	fallbackCode?: FailureCode;
	compensate?: (songId: string) => Promise<Result<void, DbError>>;
	run: (candidateSongIds: string[]) => Promise<StageOutcome>;
}

export async function runStageWithAccounting(
	params: RunStageWithAccountingParams,
): Promise<Result<StageSummary, StageAccountingError>> {
	const {
		stage,
		candidateSongIds,
		jobId,
		accountId,
		fallbackCode = FAILURE_CODES.PROVIDER_TRANSIENT,
		run,
	} = params;

	let outcome: StageOutcome;
	try {
		outcome = await run(candidateSongIds);
	} catch (error) {
		console.error(`[worker-chunk] Stage ${stage} threw:`, error);
		outcome = makeThrownOutcome(stage, candidateSongIds, error, fallbackCode);
	}

	return finalizeStageOutcome({
		outcome,
		jobId,
		accountId,
		compensate: params.compensate,
	});
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

	// Mirrors select_entitled_data_enriched_liked_song_ids: audio_features is
	// optional, so readiness is genres + analysis + embedding.
	const [analysisResult, embeddingsResult] = await Promise.all([
		getSongAnalysis(batch.songIds),
		embeddingService.getEmbeddings(batch.songIds),
	]);

	if (Result.isError(analysisResult) || Result.isError(embeddingsResult)) {
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
): Promise<void> {
	// Phase A: audio_features + genre_tagging (parallel, entitled songs only)
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
		workPlan.flags,
	);

	// Candidate-side enrichment only (phases A-C)
	await enrichSongs(ctx, workPlan, batch, jobId, progress);

	progress.currentStage = undefined;
	await persistProgress(jobId, progress);

	const songsResult = await getSongsByIds(batch.songIds);
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

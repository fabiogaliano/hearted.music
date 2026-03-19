import { Result } from "better-result";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import { updateJobProgress } from "@/lib/data/jobs";
import { getTerminallyFailedSongIds } from "@/lib/data/job-failures";
import type { EnrichmentChunkProgress } from "@/lib/platform/jobs/progress/types";
import { selectPipelineBatch, selectDataEnrichmentBatch } from "./batch";
import {
	markItemsNew,
	markPipelineProcessed,
} from "@/lib/domains/library/liked-songs/status-queries";
import { runAudioFeatures } from "./stages/audio-features";
import { runGenreTagging } from "./stages/genre-tagging";
import { runSongAnalysis } from "./stages/song-analysis";
import { runSongEmbedding } from "./stages/song-embedding";
import { runPlaylistProfiling } from "./stages/playlist-profiling";
import {
	loadExclusionSet,
	runMatching,
	type MatchingStageResult,
} from "./stages/matching";
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

interface MatchingSongsResult {
	matchedSongIds: string[];
	noMatchSongIds: string[];
	skipped: boolean;
}

async function matchSongs(
	ctx: EnrichmentContext,
	batch: Awaited<ReturnType<typeof selectPipelineBatch>>,
	jobId: string,
	progress: EnrichmentChunkProgress,
): Promise<MatchingSongsResult> {
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

	if (profilingPlaylists.length === 0) {
		progress.stages.matching.status = "skipped";
		await persistProgress(jobId, progress);
		return {
			matchedSongIds: [],
			noMatchSongIds: [],
			skipped: true,
		};
	}

	// Load exclusion set before matching
	let exclusionSet: Set<string> | undefined;
	try {
		exclusionSet = await loadExclusionSet(ctx.accountId);
	} catch (error) {
		console.error("[worker-chunk] Failed to load exclusion set:", error);
	}

	// Phase E: matching
	progress.currentStage = "matching";
	progress.stages.matching.status = "running";
	await persistProgress(jobId, progress);

	let matchingStageResult: MatchingStageResult;
	try {
		matchingStageResult = await runMatching(
			ctx,
			batch,
			profilingPlaylists,
			exclusionSet,
		);
	} catch (error) {
		console.error("[worker-chunk] Stage matching threw:", error);
		matchingStageResult = {
			total: 0,
			succeeded: 0,
			noMatch: 0,
			matchedSongIds: [],
			noMatchSongIds: [],
			excludedSongIds: [],
			skipped: true,
		};
	}

	const matchStageForProgress: StageResult = {
		total: matchingStageResult.total,
		succeeded: matchingStageResult.succeeded,
		failed: matchingStageResult.noMatch,
	};
	applyStageResult(
		progress,
		"matching",
		matchStageForProgress,
		stageStatus(matchStageForProgress),
	);

	return {
		matchedSongIds: matchingStageResult.matchedSongIds,
		noMatchSongIds: matchingStageResult.noMatchSongIds,
		skipped: matchingStageResult.skipped,
	};
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
	const matchingResult = await matchSongs(ctx, batch, jobId, progress);

	// Write item_status for ALL batch songs per spec design decision 6.
	// markItemsNew for songs with suggestions (is_new = true).
	// markPipelineProcessed for everything else (is_new = false, no viewed_at).
	if (matchingResult.matchedSongIds.length > 0) {
		await markItemsNew(accountId, "song", matchingResult.matchedSongIds);
	}

	const nonMatchedIds = batch.songIds.filter(
		(id) => !matchingResult.matchedSongIds.includes(id),
	);
	if (nonMatchedIds.length > 0) {
		await markPipelineProcessed(accountId, "song", nonMatchedIds);
	}

	progress.currentStage = undefined;
	await persistProgress(jobId, progress);

	// Two-mode hasMoreSongs probe:
	// If matching was skipped (no playlists), only check for songs needing shared data artifacts.
	// Otherwise check full pipeline including item_status.
	const probeExcludeIds = excludeIds.length > 0 ? excludeIds : undefined;
	const nextBatch = matchingResult.skipped
		? await selectDataEnrichmentBatch(accountId, 1, probeExcludeIds)
		: await selectPipelineBatch(accountId, 1, probeExcludeIds);
	return { hasMoreSongs: nextBatch.songIds.length > 0 };
}

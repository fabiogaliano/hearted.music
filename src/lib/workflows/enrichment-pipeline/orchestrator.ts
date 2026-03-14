import { Result } from "better-result";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import { getDestinationPlaylists } from "@/lib/domains/library/playlists/queries";
import { selectPipelineBatch } from "./batch";
import { runAudioFeaturesStage } from "./stages/audio-features";
import { runGenreTaggingStage } from "./stages/genre-tagging";
import { runSongAnalysisStage } from "./stages/song-analysis";
import { runSongEmbeddingStage } from "./stages/song-embedding";
import {
	runPlaylistProfilingStage,
	type PlaylistProfilingOutput,
} from "./stages/playlist-profiling";
import { runMatchingStage } from "./stages/matching";
import {
	PipelineBootstrapError,
	type EnrichmentContext,
	type EnrichmentRunResult,
	type EnrichmentStageName,
	type EnrichmentStageResult,
	type PipelineOptions,
} from "./types";

const ENV_BATCH_SIZE_KEY = "PIPELINE_BATCH_SIZE";
const ENV_BATCH_SIZE_KEY_LEGACY = "PIPELINE_MAX_SONGS";

function resolveBatchSize(options?: PipelineOptions): number {
	const envSize =
		process.env[ENV_BATCH_SIZE_KEY] ?? process.env[ENV_BATCH_SIZE_KEY_LEGACY];
	return envSize ? Number.parseInt(envSize, 10) : (options?.batchSize ?? 5);
}

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

function collectStageJobIds(
	stages: EnrichmentStageResult[],
): Partial<Record<EnrichmentStageName, string>> {
	const stageJobIds: Partial<Record<EnrichmentStageName, string>> = {};
	for (const s of stages) {
		if ((s.status === "completed" || s.status === "failed") && s.jobId) {
			stageJobIds[s.stage] = s.jobId;
		}
	}
	return stageJobIds;
}

async function runStage(
	stageName: EnrichmentStageName,
	fn: () => Promise<EnrichmentStageResult>,
): Promise<EnrichmentStageResult> {
	try {
		return await fn();
	} catch (error) {
		return {
			stage: stageName,
			status: "failed",
			jobId: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

// --- Trigger-scoped entry points ---

export async function runSongEnrichment(
	accountId: string,
	options?: PipelineOptions,
): Promise<Result<EnrichmentRunResult, PipelineBootstrapError>> {
	const startTime = Date.now();

	const embeddingResult = initEmbeddingService();
	if (Result.isError(embeddingResult)) return embeddingResult;

	const batchSize = resolveBatchSize(options);
	const batch = await selectPipelineBatch(accountId, batchSize);

	if (batch.songIds.length === 0) {
		const skipped: EnrichmentStageResult[] = [
			{ stage: "audio_features", status: "skipped", reason: "empty batch" },
			{ stage: "genre_tagging", status: "skipped", reason: "empty batch" },
			{ stage: "song_analysis", status: "skipped", reason: "empty batch" },
			{ stage: "song_embedding", status: "skipped", reason: "empty batch" },
		];
		return Result.ok({
			stages: skipped,
			stageJobIds: {},
			totalDurationMs: Date.now() - startTime,
		});
	}

	const ctx = buildContext(accountId, embeddingResult.value);

	// Phase A: audio_features + genre_tagging (parallel)
	const [audioFeaturesResult, genreTaggingResult] = await Promise.all([
		runStage("audio_features", () => runAudioFeaturesStage(ctx, batch)),
		runStage("genre_tagging", () => runGenreTaggingStage(ctx, batch)),
	]);

	// Phase B: song analysis (reads audio features from Phase A)
	const songAnalysisResult = await runStage("song_analysis", () =>
		runSongAnalysisStage(ctx, batch),
	);

	// Phase C: song embedding (requires analysis from Phase B)
	const songEmbeddingResult = await runStage("song_embedding", () =>
		runSongEmbeddingStage(ctx, batch),
	);

	const stages = [
		audioFeaturesResult,
		genreTaggingResult,
		songAnalysisResult,
		songEmbeddingResult,
	];

	const totalDurationMs = Date.now() - startTime;
	console.log(`[pipeline] Song enrichment completed in ${totalDurationMs}ms`);

	return Result.ok({
		stages,
		stageJobIds: collectStageJobIds(stages),
		totalDurationMs,
	});
}

export async function runDestinationProfiling(
	accountId: string,
): Promise<Result<EnrichmentRunResult, PipelineBootstrapError>> {
	const startTime = Date.now();

	const embeddingResult = initEmbeddingService();
	if (Result.isError(embeddingResult)) return embeddingResult;

	const ctx = buildContext(accountId, embeddingResult.value);

	const profilingOutput = await runPlaylistProfilingStage(ctx).catch(
		(error): PlaylistProfilingOutput => ({
			result: {
				stage: "playlist_profiling",
				status: "failed",
				jobId: null,
				error: error instanceof Error ? error.message : String(error),
			},
			playlists: [],
		}),
	);

	const stages = [profilingOutput.result];
	const totalDurationMs = Date.now() - startTime;
	console.log(
		`[pipeline] Destination profiling completed in ${totalDurationMs}ms`,
	);

	return Result.ok({
		stages,
		stageJobIds: collectStageJobIds(stages),
		totalDurationMs,
	});
}

export async function runMatching(
	accountId: string,
	options?: PipelineOptions,
): Promise<Result<EnrichmentRunResult, PipelineBootstrapError>> {
	const startTime = Date.now();

	const embeddingResult = initEmbeddingService();
	if (Result.isError(embeddingResult)) return embeddingResult;

	const batchSize = resolveBatchSize(options);
	const batch = await selectPipelineBatch(accountId, batchSize);
	const ctx = buildContext(accountId, embeddingResult.value);

	const playlistsResult = await getDestinationPlaylists(accountId);
	if (Result.isError(playlistsResult)) {
		const stages: EnrichmentStageResult[] = [
			{
				stage: "matching",
				status: "failed",
				jobId: null,
				error: `Failed to get destination playlists: ${playlistsResult.error.message}`,
			},
		];

		return Result.ok({
			stages,
			stageJobIds: collectStageJobIds(stages),
			totalDurationMs: Date.now() - startTime,
		});
	}

	const matchingResult = await runStage("matching", () =>
		runMatchingStage(ctx, batch, playlistsResult.value),
	);

	const stages = [matchingResult];
	const totalDurationMs = Date.now() - startTime;
	console.log(`[pipeline] Matching completed in ${totalDurationMs}ms`);

	return Result.ok({
		stages,
		stageJobIds: collectStageJobIds(stages),
		totalDurationMs,
	});
}

// --- Backward-compatible wrapper ---

export async function runEnrichmentPipeline(
	accountId: string,
	options?: PipelineOptions,
): Promise<Result<EnrichmentRunResult, PipelineBootstrapError>> {
	const startTime = Date.now();

	const songResult = await runSongEnrichment(accountId, options);
	if (Result.isError(songResult)) return songResult;

	const allSongStagesSkipped = songResult.value.stages.every(
		(s) => s.status === "skipped",
	);

	// Skip destination work when no liked-song candidates exist
	if (allSongStagesSkipped) {
		const stages: EnrichmentStageResult[] = [
			...songResult.value.stages,
			{ stage: "playlist_profiling", status: "skipped", reason: "empty batch" },
			{ stage: "matching", status: "skipped", reason: "empty batch" },
		];
		return Result.ok({
			stages,
			stageJobIds: {},
			totalDurationMs: Date.now() - startTime,
		});
	}

	const profilingResult = await runDestinationProfiling(accountId);
	if (Result.isError(profilingResult)) return profilingResult;

	const matchingResult = await runMatching(accountId, options);
	if (Result.isError(matchingResult)) return matchingResult;

	const stages = [
		...songResult.value.stages,
		...profilingResult.value.stages,
		...matchingResult.value.stages,
	];

	const totalDurationMs = Date.now() - startTime;
	console.log(`[pipeline] Completed in ${totalDurationMs}ms`);

	return Result.ok({
		stages,
		stageJobIds: collectStageJobIds(stages),
		totalDurationMs,
	});
}

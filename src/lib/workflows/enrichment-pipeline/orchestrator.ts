import { Result } from "better-result";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import { selectPipelineBatch } from "./batch";
import { runAudioFeaturesStage } from "./stages/audio-features";
import { runGenreTaggingStage } from "./stages/genre-tagging";
import { runSongAnalysisStage } from "./stages/song-analysis";
import { runSongEmbeddingStage } from "./stages/song-embedding";
import { runPlaylistProfilingStage } from "./stages/playlist-profiling";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
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

export async function runEnrichmentPipeline(
	accountId: string,
	options?: PipelineOptions,
): Promise<Result<EnrichmentRunResult, PipelineBootstrapError>> {
	const startTime = Date.now();

	const envSize =
		process.env[ENV_BATCH_SIZE_KEY] ?? process.env[ENV_BATCH_SIZE_KEY_LEGACY];
	const batchSize = envSize
		? Number.parseInt(envSize, 10)
		: (options?.batchSize ?? 5);

	let embeddingService: EmbeddingService;
	try {
		embeddingService = new EmbeddingService();
	} catch (error) {
		return Result.err(
			new PipelineBootstrapError(
				"Failed to initialize EmbeddingService",
				error,
			),
		);
	}

	const batch = await selectPipelineBatch(accountId, batchSize);
	if (batch.songIds.length === 0) {
		const skipped: EnrichmentStageResult[] = [
			{ stage: "audio_features", status: "skipped", reason: "empty batch" },
			{ stage: "genre_tagging", status: "skipped", reason: "empty batch" },
			{ stage: "playlist_profiling", status: "skipped", reason: "empty batch" },
			{ stage: "song_analysis", status: "skipped", reason: "empty batch" },
			{ stage: "song_embedding", status: "skipped", reason: "empty batch" },
			{ stage: "matching", status: "skipped", reason: "empty batch" },
		];
		const totalDurationMs = Date.now() - startTime;
		return Result.ok({ stages: skipped, stageJobIds: {}, totalDurationMs });
	}

	const ctx: EnrichmentContext = {
		accountId,
		embeddingService,
		profilingService: createPlaylistProfilingService(embeddingService),
	};

	// Phase A: parallel-safe prep (audio features + playlist profiling)
	let playlistProfilingResult: EnrichmentStageResult;
	let playlists: Playlist[];
	const [audioFeaturesResult, genreTaggingResult, profilingOutput] =
		await Promise.all([
			runStage("audio_features", () => runAudioFeaturesStage(ctx, batch)),
			runStage("genre_tagging", () => runGenreTaggingStage(ctx, batch)),
			runPlaylistProfilingStage(ctx).catch(
				(
					error,
				): {
					result: EnrichmentStageResult;
					playlists: Playlist[];
				} => ({
					result: {
						stage: "playlist_profiling",
						status: "failed",
						jobId: null,
						error: error instanceof Error ? error.message : String(error),
					},
					playlists: [],
				}),
			),
		]);
	playlistProfilingResult = profilingOutput.result;
	playlists = profilingOutput.playlists;

	// Phase B: song analysis (reads audio features written in Phase A)
	const songAnalysisResult = await runStage("song_analysis", () =>
		runSongAnalysisStage(ctx, batch),
	);

	// Phase C: song embedding (requires analysis from Phase B)
	const songEmbeddingResult = await runStage("song_embedding", () =>
		runSongEmbeddingStage(ctx, batch),
	);

	// Phase D: matching (reads embeddings, audio features, playlist profiles)
	const matchingResult = await runStage("matching", () =>
		runMatchingStage(ctx, batch, playlists),
	);

	const stages: EnrichmentStageResult[] = [
		audioFeaturesResult,
		genreTaggingResult,
		playlistProfilingResult,
		songAnalysisResult,
		songEmbeddingResult,
		matchingResult,
	];

	const stageJobIds: Partial<Record<EnrichmentStageName, string>> = {};
	for (const s of stages) {
		if ((s.status === "completed" || s.status === "failed") && s.jobId) {
			stageJobIds[s.stage] = s.jobId;
		}
	}

	const totalDurationMs = Date.now() - startTime;
	console.log(`[pipeline] Completed in ${totalDurationMs}ms`);

	return Result.ok({ stages, stageJobIds, totalDurationMs });
}

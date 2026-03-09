import { Result } from "better-result";
import { EmbeddingService } from "@/lib/ml/embedding/service";
import { createPlaylistProfilingService } from "@/lib/capabilities/profiling/service";
import { runAudioFeaturesStage } from "./stages/audio-features";
import { runSongAnalysisStage } from "./stages/song-analysis";
import { runSongEmbeddingStage } from "./stages/song-embedding";
import { runPlaylistProfilingStage } from "./stages/playlist-profiling";
import { runMatchingStage } from "./stages/matching";
import {
	PipelineBootstrapError,
	type EnrichmentContext,
	type EnrichmentRunResult,
	type EnrichmentStageName,
	type EnrichmentStageResult,
	type PipelineOptions,
} from "./types";

const ENV_MAX_SONGS_KEY = "PIPELINE_MAX_SONGS";

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

	const envMax = process.env[ENV_MAX_SONGS_KEY];
	const maxSongs = envMax
		? Number.parseInt(envMax, 10)
		: (options?.maxSongs ?? 5);

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

	const ctx: EnrichmentContext = {
		accountId,
		maxSongs,
		embeddingService,
		profilingService: createPlaylistProfilingService(embeddingService),
		selectedBatchSongIds: [],
		selectedBatchSongs: [],
		destinationPlaylists: [],
	};

	const stages: EnrichmentStageResult[] = [
		await runStage("audio_features", () => runAudioFeaturesStage(ctx)),
		await runStage("song_analysis", () => runSongAnalysisStage(ctx)),
		await runStage("song_embedding", () => runSongEmbeddingStage(ctx)),
		await runStage("playlist_profiling", () => runPlaylistProfilingStage(ctx)),
		await runStage("matching", () => runMatchingStage(ctx)),
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

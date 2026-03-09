import { Result } from "better-result";
import * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import { createAudioFeaturesService } from "@/lib/integrations/audio/service";
import type { TrackInfo } from "@/lib/integrations/audio/service";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import { selectPipelineBatch } from "../batch";
import { runTrackedStageJob } from "../job-runner";
import type { EnrichmentContext, EnrichmentStageResult } from "../types";

export async function runAudioFeaturesStage(
	ctx: EnrichmentContext,
): Promise<EnrichmentStageResult> {
	console.log("[pipeline] Stage 1: audio_features");

	const batch = await selectPipelineBatch(ctx.accountId, ctx.maxSongs);
	if (batch.songIds.length === 0) {
		return { stage: "audio_features", status: "skipped" };
	}

	ctx.selectedBatchSongIds = batch.songIds;
	ctx.selectedBatchSongs = batch.songs;

	const existingResult = await audioFeatureData.getBatch(batch.songIds);
	if (Result.isError(existingResult)) {
		throw new Error(
			`Failed to check existing audio features: ${existingResult.error.message}`,
		);
	}

	const tracksToFetch: TrackInfo[] = batch.songIds
		.filter((id) => !existingResult.value.has(id))
		.map((id) => ({
			songId: id,
			spotifyTrackId: batch.spotifyIdBySongId.get(id)!,
		}));

	if (tracksToFetch.length === 0) {
		return { stage: "audio_features", status: "skipped" };
	}

	const { jobId, succeeded, failed } = await runTrackedStageJob({
		accountId: ctx.accountId,
		stage: "audio_features",
		work: async () => {
			const service = createAudioFeaturesService(createReccoBeatsService());
			const fetchResult = await service.getOrFetchFeatures(tracksToFetch);
			const succeeded = Result.isOk(fetchResult) ? fetchResult.value.size : 0;
			const failed = tracksToFetch.length - succeeded;
			return {
				total: tracksToFetch.length,
				succeeded,
				failed,
				result: undefined,
			};
		},
	});

	return {
		stage: "audio_features",
		status: "completed",
		jobId,
		succeeded,
		failed,
	};
}

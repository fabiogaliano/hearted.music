import { Result } from "better-result";
import * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import { createAudioFeaturesService } from "@/lib/integrations/audio/service";
import type { TrackInfo } from "@/lib/integrations/audio/service";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import { runTrackedStageJob } from "../job-runner";
import type { PipelineBatch } from "../batch";
import type {
	EnrichmentContext,
	EnrichmentStageResult,
	ReadyResult,
} from "../types";

export async function getReadyForAudioFeatures(
	batchSongIds: string[],
): Promise<ReadyResult> {
	const existingResult = await audioFeatureData.getBatch(batchSongIds);
	if (Result.isError(existingResult)) {
		throw new Error(
			`Failed to check existing audio features: ${existingResult.error.message}`,
		);
	}

	const ready: string[] = [];
	const done: string[] = [];
	for (const id of batchSongIds) {
		if (existingResult.value.has(id)) {
			done.push(id);
		} else {
			ready.push(id);
		}
	}

	return { ready, notReady: [], done };
}

export async function runAudioFeaturesStage(
	ctx: EnrichmentContext,
	batch: PipelineBatch,
): Promise<EnrichmentStageResult> {
	console.log("[pipeline] Stage: audio_features");

	let readiness: ReadyResult;
	try {
		readiness = await getReadyForAudioFeatures(batch.songIds);
	} catch (error) {
		return {
			stage: "audio_features",
			status: "failed",
			jobId: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	if (readiness.ready.length === 0) {
		return {
			stage: "audio_features",
			status: "skipped",
			reason: "no songs need audio features",
		};
	}

	const tracksToFetch: TrackInfo[] = readiness.ready.map((id) => ({
		songId: id,
		spotifyTrackId: batch.spotifyIdBySongId.get(id)!,
	}));

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
		notReady: readiness.notReady.length,
		done: readiness.done.length,
	};
}

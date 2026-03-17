import { Result } from "better-result";
import * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import { createAudioFeaturesService } from "@/lib/integrations/audio/service";
import type { TrackInfo } from "@/lib/integrations/audio/service";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import { recordTerminalFailure } from "@/lib/data/job-failures";
import type { PipelineBatch } from "../batch";
import type { EnrichmentContext, ReadyResult } from "../types";

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

export async function runAudioFeatures(
	ctx: EnrichmentContext,
	batch: PipelineBatch,
): Promise<{ total: number; succeeded: number; failed: number }> {
	let readiness: ReadyResult;
	try {
		readiness = await getReadyForAudioFeatures(batch.songIds);
	} catch {
		return {
			total: batch.songIds.length,
			succeeded: 0,
			failed: batch.songIds.length,
		};
	}

	if (readiness.ready.length === 0) {
		return { total: 0, succeeded: 0, failed: 0 };
	}

	const tracksToFetch: TrackInfo[] = readiness.ready.map((id) => ({
		songId: id,
		spotifyTrackId: batch.spotifyIdBySongId.get(id)!,
	}));

	const service = createAudioFeaturesService(createReccoBeatsService());
	const fetchResult = await service.getOrFetchFeatures(tracksToFetch);
	const succeededMap = Result.isOk(fetchResult) ? fetchResult.value : new Map();
	const succeeded = succeededMap.size;
	const failed = tracksToFetch.length - succeeded;

	if (failed > 0 && ctx.jobId) {
		const failedSongIds = tracksToFetch
			.filter((t) => !succeededMap.has(t.songId))
			.map((t) => t.songId);

		await Promise.all(
			failedSongIds.map((songId) =>
				recordTerminalFailure({
					jobId: ctx.jobId!,
					itemId: songId,
					errorType: "permanent",
					errorMessage: "Audio features unavailable for track",
				}),
			),
		);
	}

	return { total: tracksToFetch.length, succeeded, failed };
}

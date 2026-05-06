import { Result } from "better-result";
import { resolveStageFailures } from "@/lib/data/job-failures";
import * as audioFeatureData from "@/lib/domains/enrichment/audio-features/queries";
import {
	type AudioFeaturesFailureKind,
	createAudioFeaturesService,
	type TrackInfo,
} from "@/lib/integrations/audio/service";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import { recordStageFailure } from "../record-failure";
import type { EnrichmentContext, ReadyResult } from "../types";

const STAGE = "audio_features";

function failureCodeFor(kind: AudioFeaturesFailureKind): string {
	return kind === "not_found"
		? FAILURE_CODES.SOURCE_NOT_FOUND
		: FAILURE_CODES.PROVIDER_TRANSIENT;
}

function failureMessageFor(kind: AudioFeaturesFailureKind): string {
	return kind === "not_found"
		? "Track not in ReccoBeats catalog"
		: "Audio features provider transient failure";
}

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

	const tracksToFetch: TrackInfo[] = readiness.ready.map((id) => {
		const spotifyTrackId = batch.spotifyIdBySongId.get(id);
		if (!spotifyTrackId) {
			throw new Error(`Missing Spotify ID for song ${id}`);
		}
		return { songId: id, spotifyTrackId };
	});

	const service = createAudioFeaturesService(createReccoBeatsService());
	const fetchResult = await service.getOrFetchFeatures(tracksToFetch);
	const succeededMap = Result.isOk(fetchResult)
		? fetchResult.value.features
		: new Map<string, audioFeatureData.AudioFeature>();
	const failureMap = Result.isOk(fetchResult)
		? fetchResult.value.failures
		: new Map<string, AudioFeaturesFailureKind>();
	const succeeded = succeededMap.size;
	const failed = tracksToFetch.length - succeeded;

	const succeededIds = Array.from(succeededMap.keys());
	if (succeededIds.length > 0) {
		await Promise.all(
			succeededIds.map((songId) =>
				resolveStageFailures({
					accountId: ctx.accountId,
					itemId: songId,
					stage: STAGE,
				}),
			),
		);
	}

	const jobId = ctx.jobId;
	if (failed > 0 && jobId) {
		const failedSongIds = tracksToFetch
			.filter((t) => !succeededMap.has(t.songId))
			.map((t) => t.songId);

		await Promise.all(
			failedSongIds.map((songId) => {
				// Default unknown to transient so we keep retrying instead of giving up.
				const kind: AudioFeaturesFailureKind =
					failureMap.get(songId) ?? "transient";
				return recordStageFailure({
					jobId,
					accountId: ctx.accountId,
					songId,
					stage: STAGE,
					failureCode: failureCodeFor(kind),
					errorMessage: failureMessageFor(kind),
				});
			}),
		);
	}

	return { total: tracksToFetch.length, succeeded, failed };
}

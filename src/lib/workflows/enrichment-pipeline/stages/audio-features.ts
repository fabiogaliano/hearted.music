import { Result } from "better-result";
import {
	type AudioFeature,
	getBatch as getAudioFeaturesBatch,
} from "@/lib/domains/enrichment/audio-features/queries";
import {
	type AudioFeaturesFailureKind,
	createAudioFeaturesService,
	type TrackInfo,
} from "@/lib/integrations/audio/service";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import type { StageFailure, StageOutcome } from "../stage-outcomes";
import type { EnrichmentContext, ReadyResult } from "../types";

const STAGE = "audio_features" as const;

function failureCodeFor(kind: AudioFeaturesFailureKind) {
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
	const existingResult = await getAudioFeaturesBatch(batchSongIds);
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
	_ctx: EnrichmentContext,
	batch: PipelineBatch,
): Promise<StageOutcome> {
	const readiness = await getReadyForAudioFeatures(batch.songIds);

	if (readiness.ready.length === 0) {
		return {
			kind: "skipped",
			stage: STAGE,
			candidateSongIds: batch.songIds,
		};
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
		: new Map<string, AudioFeature>();
	const failureMap = Result.isOk(fetchResult)
		? fetchResult.value.failures
		: new Map<string, AudioFeaturesFailureKind>();

	const succeededSongIds = Array.from(succeededMap.keys());

	const failures: StageFailure[] = tracksToFetch
		.filter((t) => !succeededMap.has(t.songId))
		.map((t) => {
			const kind: AudioFeaturesFailureKind =
				failureMap.get(t.songId) ?? "transient";
			return {
				songId: t.songId,
				failureCode: failureCodeFor(kind),
				message: failureMessageFor(kind),
			};
		});

	return {
		kind: "attempted",
		stage: STAGE,
		candidateSongIds: batch.songIds,
		attemptedSongIds: readiness.ready,
		succeededSongIds,
		failures,
	};
}

import { Result } from "better-result";
import {
	enqueueSearchJob,
	getAudioFeatureAvailability,
} from "@/lib/domains/enrichment/audio-feature-backfill/jobs";
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
import { log } from "@/lib/observability/logger";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import type { StageFailure, StageOutcome } from "../stage-outcomes";
import type { EnrichmentContext, ReadyResult } from "../types";

const STAGE = "audio_features" as const;

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

/**
 * Audio features stage, state-driven (see the backfill plan):
 *   ready                → already satisfied (feature row exists)
 *   backfill_active      → deferred; do NOT call ReccoBeats catalog
 *   manual_needed/terminal → confirmed unavailable; no catalog, no auto re-search
 *   absent               → call ReccoBeats catalog; on not_found, enqueue a
 *                          youtube_search backfill job and defer (no source_not_found
 *                          failure row — deferral is the active job, not a suppression)
 */
export async function runAudioFeatures(
	ctx: EnrichmentContext,
	batch: PipelineBatch,
): Promise<StageOutcome> {
	const readiness = await getReadyForAudioFeatures(batch.songIds);

	if (readiness.ready.length === 0) {
		return { kind: "skipped", stage: STAGE, candidateSongIds: batch.songIds };
	}

	const availabilityResult = await getAudioFeatureAvailability(readiness.ready);
	if (Result.isError(availabilityResult)) {
		throw new Error(
			`Failed to resolve audio availability: ${availabilityResult.error.message}`,
		);
	}
	const stateBySong = new Map(
		availabilityResult.value.map((a) => [a.songId, a.state] as const),
	);

	const succeededSongIds: string[] = [];
	const deferredSongIds: string[] = [];
	const failures: StageFailure[] = [];
	const absentSongIds: string[] = [];

	for (const songId of readiness.ready) {
		// Default to absent: if the helper didn't return a row, the song has no
		// feature and no backfill job — the one state where catalog lookup is OK.
		const state = stateBySong.get(songId) ?? "absent";
		switch (state) {
			case "ready":
				succeededSongIds.push(songId);
				break;
			case "backfill_active":
			case "manual_needed":
			case "unavailable_terminal":
				deferredSongIds.push(songId);
				break;
			default:
				absentSongIds.push(songId);
		}
	}

	if (absentSongIds.length > 0) {
		const tracksToFetch: TrackInfo[] = absentSongIds.map((id) => {
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

		for (const track of tracksToFetch) {
			if (succeededMap.has(track.songId)) {
				succeededSongIds.push(track.songId);
				continue;
			}

			const kind = failureMap.get(track.songId) ?? "transient";
			if (kind === "not_found") {
				// Catalog miss is deferred work, not a failure: enqueue (or adopt an
				// existing) youtube_search backfill job and defer this song.
				const enqueued = await enqueueSearchJob(track.songId, ctx.accountId);
				if (Result.isError(enqueued)) {
					failures.push({
						songId: track.songId,
						failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
						message: `Failed to enqueue audio backfill: ${enqueued.error.message}`,
					});
					continue;
				}
				log.info("youtube-audio-backfill-queued", {
					songId: track.songId,
					jobId: enqueued.value.id,
				});
				deferredSongIds.push(track.songId);
			} else {
				failures.push({
					songId: track.songId,
					failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
					message: "Audio features provider transient failure",
				});
			}
		}
	}

	return {
		kind: "attempted",
		stage: STAGE,
		candidateSongIds: batch.songIds,
		attemptedSongIds: readiness.ready,
		succeededSongIds,
		deferredSongIds,
		failures,
	};
}

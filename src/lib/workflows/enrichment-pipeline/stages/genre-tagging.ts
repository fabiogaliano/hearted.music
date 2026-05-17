import { Result } from "better-result";
import type { GenreEnrichmentInput } from "@/lib/domains/enrichment/genre-tagging/service";
import { createGenreEnrichmentService } from "@/lib/domains/enrichment/genre-tagging/service";
import type { PipelineBatch } from "../batch";
import { FAILURE_CODES } from "../failure-policy";
import type { StageFailure, StageOutcome } from "../stage-outcomes";
import type { EnrichmentContext, ReadyResult } from "../types";

const STAGE = "genre_tagging" as const;

function getReadyForGenreTagging(
	batchSongs: PipelineBatch["songs"],
): ReadyResult {
	const ready: string[] = [];
	const done: string[] = [];
	for (const s of batchSongs) {
		if (s.genres && s.genres.length > 0) {
			done.push(s.id);
		} else {
			ready.push(s.id);
		}
	}
	return { ready, notReady: [], done };
}

export async function runGenreTagging(
	_ctx: EnrichmentContext,
	batch: PipelineBatch,
): Promise<StageOutcome> {
	const readiness = getReadyForGenreTagging(batch.songs);

	if (readiness.ready.length === 0) {
		return { kind: "skipped", stage: STAGE, candidateSongIds: batch.songIds };
	}

	const inputs: GenreEnrichmentInput[] = readiness.ready.map((id) => {
		const song = batch.songs.find((s) => s.id === id);
		if (!song) {
			throw new Error(`Song ${id} present in readiness but missing from batch`);
		}
		return {
			songId: song.id,
			artist: song.artists[0] ?? "Unknown",
			trackName: song.name,
			album: song.album_name ?? undefined,
		};
	});

	const service = createGenreEnrichmentService();
	const enrichResult = await service.enrichBatch(inputs);

	if (Result.isError(enrichResult)) {
		return {
			kind: "attempted",
			stage: STAGE,
			candidateSongIds: batch.songIds,
			attemptedSongIds: readiness.ready,
			succeededSongIds: [],
			failures: inputs.map((i) => ({
				songId: i.songId,
				failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
				message: `Genre tagging batch failed: ${enrichResult.error.message}`,
			})),
		};
	}

	const { errors, notFound, unavailable, results } = enrichResult.value;

	const succeededSongIds = Array.from(results.keys());

	const failures: StageFailure[] = [];

	for (const [songId, errorMsg] of errors) {
		failures.push({
			songId,
			failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
			message: `Genre tagging failed: ${errorMsg}`,
		});
	}

	for (const songId of notFound) {
		failures.push({
			songId,
			failureCode: FAILURE_CODES.SOURCE_NOT_FOUND,
			message: "No genre data found for track",
		});
	}

	for (const songId of unavailable) {
		failures.push({
			songId,
			failureCode: FAILURE_CODES.PROVIDER_UNAVAILABLE,
			message: "Genre provider not configured",
		});
	}

	return {
		kind: "attempted",
		stage: STAGE,
		candidateSongIds: batch.songIds,
		attemptedSongIds: readiness.ready,
		succeededSongIds,
		failures,
	};
}

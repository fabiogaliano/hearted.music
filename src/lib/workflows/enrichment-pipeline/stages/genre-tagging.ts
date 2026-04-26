import { Result } from "better-result";
import { createGenreEnrichmentService } from "@/lib/domains/enrichment/genre-tagging/service";
import type { GenreEnrichmentInput } from "@/lib/domains/enrichment/genre-tagging/service";
import { resolveStageFailures } from "@/lib/data/job-failures";
import { FAILURE_CODES } from "../failure-policy";
import { recordStageFailure } from "../record-failure";
import type { PipelineBatch } from "../batch";
import type { EnrichmentContext, ReadyResult } from "../types";

const STAGE = "genre_tagging";

export function getReadyForGenreTagging(
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
	ctx: EnrichmentContext,
	batch: PipelineBatch,
): Promise<{ total: number; succeeded: number; failed: number }> {
	const readiness = getReadyForGenreTagging(batch.songs);

	if (readiness.ready.length === 0) {
		return { total: 0, succeeded: 0, failed: 0 };
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
		// Batch-wide DB error — record everything as transient so the pipeline retries.
		const jobId = ctx.jobId;
		if (jobId) {
			await Promise.all(
				inputs.map((i) =>
					recordStageFailure({
						jobId,
						accountId: ctx.accountId,
						songId: i.songId,
						stage: STAGE,
						failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
						errorMessage: `Genre tagging batch failed: ${enrichResult.error.message}`,
					}),
				),
			);
		}
		return { total: inputs.length, succeeded: 0, failed: inputs.length };
	}

	const { errors, notFound, unavailable, results } = enrichResult.value;

	const succeededIds = Array.from(results.keys());
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
	if (jobId && (errors.size > 0 || notFound.size > 0 || unavailable.size > 0)) {
		const failures: Promise<unknown>[] = [];

		for (const [songId, errorMsg] of errors) {
			failures.push(
				recordStageFailure({
					jobId,
					accountId: ctx.accountId,
					songId,
					stage: STAGE,
					failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
					errorMessage: `Genre tagging failed: ${errorMsg}`,
				}),
			);
		}

		for (const songId of notFound) {
			failures.push(
				recordStageFailure({
					jobId,
					accountId: ctx.accountId,
					songId,
					stage: STAGE,
					failureCode: FAILURE_CODES.SOURCE_NOT_FOUND,
					errorMessage: "No genre data found for track",
				}),
			);
		}

		// Provider not configured (e.g. missing Last.fm API key) — must NOT
		// be classified as a catalog miss; once the config is fixed retries
		// should pick these up.
		for (const songId of unavailable) {
			failures.push(
				recordStageFailure({
					jobId,
					accountId: ctx.accountId,
					songId,
					stage: STAGE,
					failureCode: FAILURE_CODES.PROVIDER_UNAVAILABLE,
					errorMessage: "Genre provider not configured",
				}),
			);
		}

		await Promise.all(failures);
	}

	// Count every unsuccessful outcome: provider errors AND true catalog misses
	// AND songs we never asked the provider about. Reading the per-bucket sizes
	// directly (rather than stats.failed) keeps the count in lockstep with the
	// failure rows we just wrote above.
	const failed = errors.size + notFound.size + unavailable.size;
	const stats = enrichResult.value.stats;
	return {
		total: inputs.length,
		succeeded: stats.fetched + stats.cached,
		failed,
	};
}

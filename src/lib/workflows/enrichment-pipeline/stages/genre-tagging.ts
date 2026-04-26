import { Result } from "better-result";
import { createGenreEnrichmentService } from "@/lib/domains/enrichment/genre-tagging/service";
import type { GenreEnrichmentInput } from "@/lib/domains/enrichment/genre-tagging/service";
import { recordJobFailure } from "@/lib/data/job-failures";
import type { PipelineBatch } from "../batch";
import type { EnrichmentContext, ReadyResult } from "../types";

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
					recordJobFailure({
						jobId,
						itemId: i.songId,
						stage: "genre_tagging",
						failureCode: "provider_transient",
						isTerminal: false,
						errorMessage: `Genre tagging batch failed: ${enrichResult.error.message}`,
					}),
				),
			);
		}
		return { total: inputs.length, succeeded: 0, failed: inputs.length };
	}

	const { errors, notFound, unavailable } = enrichResult.value;

	const jobId = ctx.jobId;
	if (jobId && (errors.size > 0 || notFound.size > 0 || unavailable.size > 0)) {
		const failures: Promise<unknown>[] = [];

		for (const [songId, errorMsg] of errors) {
			failures.push(
				recordJobFailure({
					jobId,
					itemId: songId,
					stage: "genre_tagging",
					failureCode: "provider_transient",
					isTerminal: false,
					errorMessage: `Genre tagging failed: ${errorMsg}`,
				}),
			);
		}

		for (const songId of notFound) {
			failures.push(
				recordJobFailure({
					jobId,
					itemId: songId,
					stage: "genre_tagging",
					failureCode: "source_not_found",
					isTerminal: false,
					errorMessage: "No genre data found for track",
				}),
			);
		}

		// Provider not configured (e.g. missing Last.fm API key) — must NOT
		// be classified as a catalog miss; once the config is fixed retries
		// should pick these up.
		for (const songId of unavailable) {
			failures.push(
				recordJobFailure({
					jobId,
					itemId: songId,
					stage: "genre_tagging",
					failureCode: "provider_unavailable",
					isTerminal: false,
					errorMessage: "Genre provider not configured",
				}),
			);
		}

		await Promise.all(failures);
	}

	const stats = enrichResult.value.stats;
	return {
		total: inputs.length,
		succeeded: stats.fetched + stats.cached,
		failed: stats.failed,
	};
}

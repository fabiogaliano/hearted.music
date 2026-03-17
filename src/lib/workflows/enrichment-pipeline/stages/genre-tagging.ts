import { Result } from "better-result";
import { createGenreEnrichmentService } from "@/lib/domains/enrichment/genre-tagging/service";
import type { GenreEnrichmentInput } from "@/lib/domains/enrichment/genre-tagging/service";
import { recordTerminalFailure } from "@/lib/data/job-failures";
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
		const song = batch.songs.find((s) => s.id === id)!;
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
		return { total: inputs.length, succeeded: 0, failed: inputs.length };
	}

	const { errors, notFound } = enrichResult.value;

	if (ctx.jobId && (errors.size > 0 || notFound.size > 0)) {
		const failures: Promise<unknown>[] = [];

		for (const [songId, errorMsg] of errors) {
			failures.push(
				recordTerminalFailure({
					jobId: ctx.jobId,
					itemId: songId,
					errorType: "permanent",
					errorMessage: `Genre tagging failed: ${errorMsg}`,
				}),
			);
		}

		for (const songId of notFound) {
			failures.push(
				recordTerminalFailure({
					jobId: ctx.jobId,
					itemId: songId,
					errorType: "unsupported",
					errorMessage: "No genre data found for track",
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

import { Result } from "better-result";
import { createGenreEnrichmentService } from "@/lib/domains/enrichment/genre-tagging/service";
import type { GenreEnrichmentInput } from "@/lib/domains/enrichment/genre-tagging/service";
import { runTrackedStageJob } from "../job-runner";
import type { PipelineBatch } from "../batch";
import type {
	EnrichmentContext,
	EnrichmentStageResult,
	ReadyResult,
} from "../types";

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

export async function runGenreTaggingStage(
	ctx: EnrichmentContext,
	batch: PipelineBatch,
): Promise<EnrichmentStageResult> {
	console.log("[pipeline] Stage: genre_tagging");

	const readiness = getReadyForGenreTagging(batch.songs);

	if (readiness.ready.length === 0) {
		return {
			stage: "genre_tagging",
			status: "skipped",
			reason: "no songs need genre tagging",
		};
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

	const { jobId, succeeded, failed } = await runTrackedStageJob({
		accountId: ctx.accountId,
		stage: "genre_tagging",
		work: async () => {
			const service = createGenreEnrichmentService();
			const enrichResult = await service.enrichBatch(inputs);
			if (Result.isError(enrichResult)) {
				throw new Error(
					`Genre enrichment failed: ${enrichResult.error.message}`,
				);
			}
			const stats = enrichResult.value.stats;
			return {
				total: inputs.length,
				succeeded: stats.fetched + stats.cached,
				failed: stats.failed,
				result: undefined,
			};
		},
	});

	return {
		stage: "genre_tagging",
		status: "completed",
		jobId,
		succeeded,
		failed,
		notReady: readiness.notReady.length,
		done: readiness.done.length,
	};
}

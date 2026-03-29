import type { StageProgress } from "@/lib/platform/jobs/progress/base";
import {
	createPendingEnrichmentStages,
	type EnrichmentChunkProgress,
} from "@/lib/platform/jobs/progress/enrichment";
import type { EnrichmentStageName } from "./types";

export const ALL_STAGE_NAMES: EnrichmentStageName[] = [
	"audio_features",
	"genre_tagging",
	"song_analysis",
	"song_embedding",
];

const BATCH_SIZES = [1, 5, 10, 25, 50];

export function batchSizeForSequence(sequence: number): number {
	return BATCH_SIZES[Math.min(sequence, BATCH_SIZES.length - 1)];
}

export function makeInitialProgress(
	batchSize: number,
	batchSequence: number,
	totalSongs: number,
): EnrichmentChunkProgress {
	const stages: Record<string, StageProgress> = createPendingEnrichmentStages();

	return {
		total: totalSongs * ALL_STAGE_NAMES.length,
		done: 0,
		succeeded: 0,
		failed: 0,
		currentStage: undefined,
		stages,
		batchSize,
		batchSequence,
	};
}

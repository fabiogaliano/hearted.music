import {
	createPendingEnrichmentStages,
	type EnrichmentChunkProgress,
	type EnrichmentStageProgressMap,
} from "@/lib/platform/jobs/progress/enrichment";
import type { EnrichmentStageName, SongStageFlags } from "./types";

export type InitializedEnrichmentChunkProgress = Omit<
	EnrichmentChunkProgress,
	"stages"
> & {
	stages: Required<EnrichmentStageProgressMap>;
};

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

export function countPlannedWork(flags: readonly SongStageFlags[]): number {
	let total = 0;
	for (const f of flags) {
		if (f.needsAudioFeatures) total++;
		if (f.needsGenreTagging) total++;
		if (f.needsAnalysis) total++;
		if (f.needsEmbedding) total++;
	}
	return total;
}

/**
 * Create initial progress. Pass work plan flags for accurate totals (orchestrator),
 * or a song count estimate for job-creation contexts where the plan isn't yet known.
 */
export function makeInitialProgress(
	batchSize: number,
	batchSequence: number,
	workOrEstimate: readonly SongStageFlags[] | number,
): InitializedEnrichmentChunkProgress {
	const stages = createPendingEnrichmentStages();
	const total =
		typeof workOrEstimate === "number"
			? workOrEstimate * ALL_STAGE_NAMES.length
			: countPlannedWork(workOrEstimate);

	return {
		total,
		done: 0,
		succeeded: 0,
		failed: 0,
		currentStage: undefined,
		stages,
		batchSize,
		batchSequence,
	};
}

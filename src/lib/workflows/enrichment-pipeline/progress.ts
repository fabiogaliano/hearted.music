import type {
	EnrichmentChunkProgress,
	EnrichmentStageProgress,
} from "@/lib/platform/jobs/progress/types";
import type { EnrichmentStageName } from "./types";

export const ALL_STAGE_NAMES: EnrichmentStageName[] = [
	"audio_features",
	"genre_tagging",
	"song_analysis",
	"song_embedding",
	"playlist_profiling",
	"matching",
];

export function makeInitialProgress(
	batchSize: number,
	batchSequence: number,
	totalSongs: number,
): EnrichmentChunkProgress {
	const stages: Record<string, EnrichmentStageProgress> = {};
	for (const name of ALL_STAGE_NAMES) {
		stages[name] = { status: "pending", succeeded: 0, failed: 0 };
	}
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

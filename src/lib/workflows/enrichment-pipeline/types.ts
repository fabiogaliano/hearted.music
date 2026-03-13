import { TaggedError } from "better-result";
import type { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import type { PlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";

export type EnrichmentStageName =
	| "audio_features"
	| "genre_tagging"
	| "song_analysis"
	| "song_embedding"
	| "playlist_profiling"
	| "matching";

export interface PipelineOptions {
	readonly batchSize?: number;
}

export interface ReadyResult {
	readonly ready: string[];
	readonly notReady: string[];
	readonly done: string[];
}

export type EnrichmentStageResult =
	| {
			readonly stage: EnrichmentStageName;
			readonly status: "completed";
			readonly jobId: string | null;
			readonly succeeded: number;
			readonly failed: number;
			readonly notReady?: number;
			readonly done?: number;
	  }
	| {
			readonly stage: EnrichmentStageName;
			readonly status: "skipped";
			readonly reason?: string;
	  }
	| {
			readonly stage: EnrichmentStageName;
			readonly status: "failed";
			readonly jobId: string | null;
			readonly error?: string;
			readonly succeeded?: number;
			readonly failed?: number;
	  };

export interface EnrichmentRunResult {
	readonly stages: EnrichmentStageResult[];
	readonly stageJobIds: Partial<Record<EnrichmentStageName, string>>;
	readonly totalDurationMs: number;
}

export class PipelineBootstrapError extends TaggedError(
	"PipelineBootstrapError",
)<{
	message: string;
	cause?: unknown;
}>() {
	constructor(message: string, cause?: unknown) {
		super({ message, cause });
	}
}

export interface EnrichmentContext {
	readonly accountId: string;
	readonly embeddingService: EmbeddingService;
	readonly profilingService: PlaylistProfilingService;
}

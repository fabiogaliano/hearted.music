import { TaggedError } from "better-result";
import type { EmbeddingService } from "@/lib/ml/embedding/service";
import type { PlaylistProfilingService } from "@/lib/capabilities/profiling/service";
import type { Song } from "@/lib/data/song";
import type { Playlist } from "@/lib/data/playlists";

export type EnrichmentStageName =
	| "audio_features"
	| "song_analysis"
	| "song_embedding"
	| "playlist_profiling"
	| "matching";

export interface PipelineOptions {
	readonly maxSongs?: number;
}

export type EnrichmentStageResult =
	| {
			readonly stage: EnrichmentStageName;
			readonly status: "completed";
			readonly jobId: string | null;
			readonly succeeded: number;
			readonly failed: number;
	  }
	| { readonly stage: EnrichmentStageName; readonly status: "skipped" }
	// error is set when the stage threw; succeeded/failed counts present when the job ran but all items failed
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

// Mutable shared state threaded through all enrichment stages
export interface EnrichmentContext {
	readonly accountId: string;
	readonly maxSongs: number;
	readonly embeddingService: EmbeddingService;
	readonly profilingService: PlaylistProfilingService;
	selectedBatchSongIds: string[];
	selectedBatchSongs: Song[];
	destinationPlaylists: Playlist[];
}

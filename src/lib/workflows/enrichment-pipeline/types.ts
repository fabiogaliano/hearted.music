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

export interface ReadyResult {
	readonly ready: string[];
	readonly notReady: string[];
	readonly done: string[];
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
	readonly jobId?: string;
}

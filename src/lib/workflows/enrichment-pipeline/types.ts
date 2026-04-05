import { TaggedError } from "better-result";
import type { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import type { LlmService } from "@/lib/integrations/llm/service";
import type { RerankerService } from "@/lib/integrations/reranker/service";
import type { PlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";

export type EnrichmentStageName =
	| "audio_features"
	| "genre_tagging"
	| "song_analysis"
	| "song_embedding";

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

/** Per-song stage flags returned by the billing-aware selector RPC. */
export interface SongStageFlags {
	readonly songId: string;
	readonly needsAudioFeatures: boolean;
	readonly needsGenreTagging: boolean;
	readonly needsAnalysis: boolean;
	readonly needsEmbedding: boolean;
	readonly needsContentActivation: boolean;
}

/**
 * Work plan parsed from select_liked_song_ids_needing_enrichment_work.
 * Groups song IDs by the stage they need, so the orchestrator can run
 * each stage against only the sub-batch that requires it.
 */
export interface EnrichmentWorkPlan {
	/** All song IDs in this batch (union of all stage sub-batches). */
	readonly allSongIds: string[];
	/** Per-song flags for fine-grained stage dispatch. */
	readonly flags: SongStageFlags[];
	/** Sub-batch: songs needing audio_features stage. */
	readonly needAudioFeatures: string[];
	/** Sub-batch: songs needing genre_tagging stage. */
	readonly needGenreTagging: string[];
	/** Sub-batch: songs needing song_analysis stage (Phase B, entitled). */
	readonly needAnalysis: string[];
	/** Sub-batch: songs needing song_embedding stage (Phase C, entitled). */
	readonly needEmbedding: string[];
	/** Sub-batch: songs needing content_activation stage (entitled + analysis present). */
	readonly needContentActivation: string[];
}

export interface EnrichmentContext {
	readonly accountId: string;
	readonly embeddingService: EmbeddingService;
	readonly profilingService: PlaylistProfilingService;
	readonly llmService?: LlmService;
	readonly rerankerService?: RerankerService;
	readonly jobId?: string;
}

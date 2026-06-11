/**
 * Model Bundle Versioning System
 *
 * Tracks embedding model, reranker, algorithm versions, and enrichment config.
 * Provides deterministic configuration for automatic cache invalidation.
 *
 * Pattern: Version is implicit in cache key hash - when model/algorithm changes,
 * hash changes, causing automatic cache miss. Old cached data remains keyed by
 * old hash - no migration needed.
 */

import { Result } from "better-result";
import { GENRE_TABLE_VERSION } from "@/lib/domains/taste/genre-similarity/loader";
import { EMBEDDING_TASK_DESCRIPTION } from "@/lib/integrations/embedding/format";
import { getMlProvider } from "@/lib/integrations/providers/factory";
import type { MLProviderError } from "@/lib/shared/errors/domain/ml";
import {
	EMBEDDING_SCHEMA_VERSION,
	EXTRACTOR_VERSION,
	MATCHING_ALGO_VERSION,
	PLAYLIST_PROFILE_VERSION,
} from "./versioning";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface EmbeddingModelConfig {
	/** Model identifier (e.g., "Qwen/Qwen3-Embedding-0.6B") */
	model: string;
	/** Embedding dimensions */
	dims: number;
	/** Provider name */
	provider: "deepinfra" | "huggingface" | "local";
	/** Whether the model is instruction-tuned (affects query prefixing) */
	isInstructionTuned: boolean;
	/** Task instruction baked into query-side vectors (instruction-tuned models) */
	queryTask: string;
}

interface RerankerModelConfig {
	/** Model identifier */
	model: string;
	/** Provider name */
	provider: "deepinfra" | "huggingface" | "local";
	/** Maximum input length in tokens */
	maxLength: number;
}

interface AlgorithmVersions {
	/** Feature extractor version */
	extractor: number;
	/** Embedding schema version */
	schema: number;
	/** Playlist profile algorithm version */
	profile: number;
	/** Matching algorithm version */
	matching: string;
	/** Genre similarity table version — changes on every genresgraph sync */
	genreTable: string;
}

interface PlaylistProfilingConfig {
	/** Profiling strategy identifier — bump or rename when logic changes */
	strategy: string;
	/** Whether intent query embedding is used for blending */
	usesIntentQueryEmbedding: boolean;
	/** Whether HyDE cold-start expansion is enabled */
	usesHydeColdStart: boolean;
}

interface EnrichmentConfig {
	/** Primary genre source */
	genreSource: "lastfm" | "spotify" | "combined";
	/** Playlist profiling strategy — changes here auto-invalidate cached profiles */
	playlistProfiling: PlaylistProfilingConfig;
}

export interface ModelBundle {
	/** Embedding model configuration */
	embedding: EmbeddingModelConfig;
	/** Optional reranker configuration */
	reranker?: RerankerModelConfig;
	/** Algorithm version identifiers */
	algorithms: AlgorithmVersions;
	/** Enrichment pipeline configuration */
	enrichment: EnrichmentConfig;
	/** Bundle format version (for future schema changes) */
	version: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Active Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the currently active model bundle configuration.
 *
 * This configuration is used to generate cache keys - any change here
 * will automatically invalidate dependent caches.
 *
 * @returns Result with ModelBundle or MLProviderError if provider unavailable
 */
export function getActiveModelBundle(): Result<ModelBundle, MLProviderError> {
	// Get ML provider metadata
	const providerResult = getMlProvider();
	if (Result.isError(providerResult)) {
		return Result.err(providerResult.error);
	}
	const metadata = providerResult.value.getMetadata();

	return Result.ok({
		embedding: {
			model: metadata.embeddingModel,
			dims: metadata.embeddingDims,
			provider: metadata.name,
			isInstructionTuned: metadata.embeddingInstructionTuned,
			// Part of every query-side vector's bytes, so it participates in the
			// bundle hash — rewording it invalidates cached profiles/embeddings.
			queryTask: metadata.embeddingInstructionTuned
				? EMBEDDING_TASK_DESCRIPTION
				: "",
		},
		algorithms: {
			extractor: EXTRACTOR_VERSION,
			schema: EMBEDDING_SCHEMA_VERSION,
			profile: PLAYLIST_PROFILE_VERSION,
			matching: MATCHING_ALGO_VERSION,
			// Every genresgraph sync changes the table version, which changes this
			// bundle's hash and auto-invalidates all profile + snapshot caches.
			genreTable: GENRE_TABLE_VERSION,
		},
		enrichment: {
			genreSource: "lastfm",
			playlistProfiling: {
				strategy: "hyde_v1",
				usesIntentQueryEmbedding: true,
				usesHydeColdStart: true,
			},
		},
		version: 1,
	});
}

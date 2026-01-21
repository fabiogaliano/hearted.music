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
import type { MLProviderError } from "@/lib/shared/errors/domain/ml";
import { getMlProvider } from "@/lib/ml/provider/factory";
import {
	EXTRACTOR_VERSION,
	EMBEDDING_SCHEMA_VERSION,
	PLAYLIST_PROFILE_VERSION,
	MATCHING_ALGO_VERSION,
} from "./versioning";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbeddingModelConfig {
	/** Model identifier (e.g., "intfloat/multilingual-e5-large-instruct") */
	model: string;
	/** Embedding dimensions */
	dims: number;
	/** Provider name */
	provider: "deepinfra" | "huggingface" | "local";
	/** Whether the model is instruction-tuned (affects query prefixing) */
	isInstructionTuned: boolean;
}

export interface RerankerModelConfig {
	/** Model identifier */
	model: string;
	/** Provider name */
	provider: "deepinfra" | "huggingface" | "local";
	/** Maximum input length in tokens */
	maxLength: number;
}

export interface AlgorithmVersions {
	/** Feature extractor version */
	extractor: number;
	/** Embedding schema version */
	schema: number;
	/** Playlist profile algorithm version */
	profile: number;
	/** Matching algorithm version */
	matching: string;
}

export interface EnrichmentConfig {
	/** Primary genre source */
	genreSource: "lastfm" | "spotify" | "combined";
	/** Whether emotion analysis is enabled */
	emotionEnabled: boolean;
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
			isInstructionTuned: true, // e5-large-instruct is instruction-tuned
		},
		// Reranker not currently used - uncomment when enabled
		// reranker: {
		//     model: metadata.rerankerModel ?? "BAAI/bge-reranker-v2-m3",
		//     provider: metadata.name,
		//     maxLength: 8192,
		// },
		algorithms: {
			extractor: EXTRACTOR_VERSION,
			schema: EMBEDDING_SCHEMA_VERSION,
			profile: PLAYLIST_PROFILE_VERSION,
			matching: MATCHING_ALGO_VERSION,
		},
		enrichment: {
			genreSource: "lastfm",
			emotionEnabled: false, // Not yet implemented
		},
		version: 1,
	});
}

/**
 * Provider-agnostic types for ML operations.
 *
 * These types abstract over provider-specific implementations,
 * allowing consumers to work with a consistent interface.
 */

import { z } from "zod";

// ============================================================================
// Provider Metadata
// ============================================================================

/**
 * Identifies which ML provider is being used.
 */
export const ProviderNameSchema = z.enum(["deepinfra", "huggingface", "local"]);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

/**
 * Provider metadata for cache keys and debugging.
 */
export const ProviderMetadataSchema = z.object({
	/** Provider name */
	name: ProviderNameSchema,
	/** Embedding model identifier */
	embeddingModel: z.string(),
	/** Embedding dimensions */
	embeddingDims: z.number(),
	/** Reranker model identifier (optional) */
	rerankerModel: z.string().optional(),
});
export type ProviderMetadata = z.infer<typeof ProviderMetadataSchema>;

// ============================================================================
// Embedding Types
// ============================================================================

/**
 * Prefix for instruction-tuned embedding models.
 */
export const EmbedPrefixSchema = z.enum(["query:", "passage:"]);
export type EmbedPrefix = z.infer<typeof EmbedPrefixSchema>;

/**
 * Options for embedding operations.
 */
export const EmbedOptionsSchema = z.object({
	/** Prefix for optimal results: "query:" for search, "passage:" for documents */
	prefix: EmbedPrefixSchema.optional(),
	/** Timeout in milliseconds */
	timeoutMs: z.number().positive().optional(),
});
export type EmbedOptions = z.infer<typeof EmbedOptionsSchema>;

/**
 * Result of an embedding operation.
 */
export const EmbeddingResultSchema = z.object({
	/** Embedding vector */
	embedding: z.array(z.number()),
	/** Model that generated the embedding */
	model: z.string(),
	/** Dimensionality of the embedding */
	dims: z.number(),
});
export type EmbeddingResult = z.infer<typeof EmbeddingResultSchema>;

// ============================================================================
// Reranking Types
// ============================================================================

/**
 * Options for reranking operations.
 */
export const RerankOptionsSchema = z.object({
	/** Maximum number of documents to return (0 = all) */
	topK: z.number().nonnegative().optional(),
	/** Timeout in milliseconds */
	timeoutMs: z.number().positive().optional(),
});
export type RerankOptions = z.infer<typeof RerankOptionsSchema>;

/**
 * Reranking score for a single document.
 */
export const RerankScoreSchema = z.object({
	/** Index of the document in the input array */
	index: z.number(),
	/** Relevance score (higher = more relevant) */
	score: z.number(),
});
export type RerankScore = z.infer<typeof RerankScoreSchema>;

/**
 * Result of a reranking operation.
 */
export const RerankResultSchema = z.object({
	/** Reranked scores sorted by relevance */
	scores: z.array(RerankScoreSchema),
	/** Model that generated the scores */
	model: z.string(),
});
export type RerankResult = z.infer<typeof RerankResultSchema>;

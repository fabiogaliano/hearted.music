/**
 * MLProvider - Port interface for ML backend abstraction.
 *
 * Defines the contract for ML providers (DeepInfra, HuggingFace, Local).
 * All providers must implement embedding and reranking operations.
 *
 * This enables:
 * - Switching between ML backends via environment configuration
 * - Local development without API keys
 * - Testing with different models
 * - Graceful degradation when services are unavailable
 */

import type { Result } from "better-result";
import type { MLProviderError } from "@/lib/shared/errors/domain/ml";
import type {
	EmbeddingResult,
	EmbedOptions,
	ProviderMetadata,
	RerankOptions,
	RerankResult,
} from "./types";

/**
 * ML Provider interface - all backends must implement this.
 */
export interface MLProvider {
	/**
	 * Embeds a single text string.
	 *
	 * @param text - Text to embed
	 * @param options - Embedding options (prefix, timeout)
	 * @returns Result containing embedding vector or error
	 */
	embed(
		text: string,
		options?: EmbedOptions,
	): Promise<Result<EmbeddingResult, MLProviderError>>;

	/**
	 * Embeds multiple texts in a batch.
	 *
	 * @param texts - Array of texts to embed
	 * @param options - Embedding options (prefix, timeout)
	 * @returns Result containing array of embedding results or error
	 */
	embedBatch(
		texts: string[],
		options?: EmbedOptions,
	): Promise<Result<EmbeddingResult[], MLProviderError>>;

	/**
	 * Reranks documents based on relevance to a query.
	 *
	 * @param query - Query text to rank against
	 * @param documents - Documents to rerank
	 * @param options - Reranking options (topK, timeout)
	 * @returns Result containing rerank scores or error
	 */
	rerank(
		query: string,
		documents: string[],
		options?: RerankOptions,
	): Promise<Result<RerankResult, MLProviderError>>;

	/**
	 * Checks if the provider is available and configured correctly.
	 *
	 * @returns true if the provider can be used, false otherwise
	 */
	isAvailable(): Promise<boolean>;

	/**
	 * Gets provider metadata (name, model, dimensions).
	 *
	 * @returns Provider metadata for cache keys and debugging
	 */
	getMetadata(): ProviderMetadata;
}

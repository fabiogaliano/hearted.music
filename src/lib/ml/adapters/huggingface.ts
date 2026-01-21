/**
 * HuggingFace ML Provider Adapter.
 *
 * Wraps the existing HuggingFace integration to conform to the MLProvider interface.
 * Maps HuggingFace-specific errors to domain ML errors.
 *
 * Models:
 * - Embedding: sentence-transformers/all-MiniLM-L6-v2 (384 dims)
 * - Reranking: Not supported (graceful degradation)
 *
 * Note: HuggingFace API is free-tier friendly and works without HF_TOKEN,
 * but has lower rate limits than DeepInfra.
 */

import { Result } from "better-result";
import * as huggingface from "@/lib/integrations/huggingface/service";
import {
	DeepInfraApiError,
	DeepInfraRateLimitError,
} from "@/lib/shared/errors/external/deepinfra";
import {
	MLApiError,
	type MLProviderError,
	MLProviderUnavailableError,
	MLRateLimitError,
	MLTimeoutError,
	MLUnsupportedOperationError,
} from "@/lib/shared/errors/domain/ml";
import type { MLProvider } from "../provider/ports";
import type {
	EmbedOptions,
	EmbeddingResult,
	ProviderMetadata,
	RerankOptions,
	RerankResult,
} from "../provider/types";

/**
 * HuggingFace provider adapter.
 */
export class HuggingFaceProvider implements MLProvider {
	private readonly metadata: ProviderMetadata;

	constructor() {
		this.metadata = {
			name: "huggingface",
			embeddingModel: huggingface.getEmbeddingModel(),
			embeddingDims: huggingface.getEmbeddingDims(),
			rerankerModel: undefined, // No reranking support
		};
	}

	async embed(
		text: string,
		options?: EmbedOptions,
	): Promise<Result<EmbeddingResult, MLProviderError>> {
		const result = await huggingface.embedText(text, options);

		if (Result.isError(result)) {
			return Result.err(this.mapError(result.error, "embed"));
		}

		// Map to standardized EmbeddingResult
		return Result.ok({
			embedding: result.value.embedding,
			model: this.metadata.embeddingModel,
			dims: result.value.dims,
		});
	}

	async embedBatch(
		texts: string[],
		options?: EmbedOptions,
	): Promise<Result<EmbeddingResult[], MLProviderError>> {
		const result = await huggingface.embedBatch(texts, options);

		if (Result.isError(result)) {
			return Result.err(this.mapError(result.error, "embedBatch"));
		}

		// Map to standardized EmbeddingResult[]
		return Result.ok(
			result.value.map((item) => ({
				embedding: item.embedding,
				model: this.metadata.embeddingModel,
				dims: item.dims,
			})),
		);
	}

	async rerank(
		_query: string,
		_documents: string[],
		_options?: RerankOptions,
	): Promise<Result<RerankResult, MLProviderError>> {
		// HuggingFace free tier doesn't support reranking models
		// Return unsupported operation error for graceful degradation
		return Result.err(
			new MLUnsupportedOperationError("huggingface", "rerank"),
		);
	}

	async isAvailable(): Promise<boolean> {
		// HuggingFace is always available (no API key required for free tier)
		return huggingface.isAvailable();
	}

	getMetadata(): ProviderMetadata {
		return this.metadata;
	}

	// ============================================================================
	// Error Mapping
	// ============================================================================

	/**
	 * Maps HuggingFace errors to domain ML errors.
	 *
	 * Note: HuggingFace service currently reuses DeepInfra error types for simplicity.
	 * This adapter maps them to the generic ML error types.
	 */
	private mapError(
		error: DeepInfraApiError | DeepInfraRateLimitError,
		operation: string,
	): MLProviderError {
		// Rate limit
		if (error instanceof DeepInfraRateLimitError) {
			return new MLRateLimitError("huggingface", error.retryAfterMs);
		}

		// API error
		if (error instanceof DeepInfraApiError) {
			// Timeout (no status code)
			if (!error.statusCode) {
				return new MLTimeoutError("huggingface", operation, 30000);
			}

			// Service unavailable
			if (error.statusCode === 503) {
				return new MLProviderUnavailableError(
					"huggingface",
					"Service unavailable",
				);
			}

			// Generic API error
			return new MLApiError(
				"huggingface",
				operation,
				error.message || "Unknown error",
				error.statusCode,
			);
		}

		// Unknown error type (should not happen)
		return new MLApiError("huggingface", operation, "Unknown error");
	}
}

/**
 * Creates a HuggingFace provider instance.
 *
 * Always succeeds since HuggingFace works without API keys (free tier).
 */
export function createHuggingFaceProvider(): HuggingFaceProvider {
	return new HuggingFaceProvider();
}

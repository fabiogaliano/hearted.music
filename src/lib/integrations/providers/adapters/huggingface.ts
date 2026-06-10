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
import {
	embedBatch,
	embedText,
	getEmbeddingDims,
	getEmbeddingModel,
	isAvailable,
} from "@/lib/integrations/huggingface/service";
import {
	MLApiError,
	type MLProviderError,
	MLProviderUnavailableError,
	MLRateLimitError,
	MLTimeoutError,
	MLUnsupportedOperationError,
} from "@/lib/shared/errors/domain/ml";
import {
	HuggingFaceApiError,
	type HuggingFaceError,
	HuggingFaceRateLimitError,
} from "@/lib/shared/errors/external/huggingface";
import type { MLProvider } from "../ports";
import type {
	EmbeddingResult,
	EmbedOptions,
	ProviderMetadata,
	RerankOptions,
	RerankResult,
} from "../types";

/**
 * HuggingFace provider adapter.
 */
class HuggingFaceProvider implements MLProvider {
	private readonly metadata: ProviderMetadata;

	constructor() {
		this.metadata = {
			name: "huggingface",
			embeddingModel: getEmbeddingModel(),
			embeddingDims: getEmbeddingDims(),
			embeddingInstructionTuned: false, // MiniLM is symmetric
			rerankerModel: undefined, // No reranking support
		};
	}

	async embed(
		text: string,
		_options?: EmbedOptions,
	): Promise<Result<EmbeddingResult, MLProviderError>> {
		// MiniLM is symmetric (no instruct prefix), so the retrieval role is moot.
		const result = await embedText(text);

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
		_options?: EmbedOptions,
	): Promise<Result<EmbeddingResult[], MLProviderError>> {
		// MiniLM is symmetric (no instruct prefix), so the retrieval role is moot.
		const result = await embedBatch(texts);

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
		return Result.err(new MLUnsupportedOperationError("huggingface", "rerank"));
	}

	async isAvailable(): Promise<boolean> {
		// HuggingFace is always available (no API key required for free tier)
		return isAvailable();
	}

	getMetadata(): ProviderMetadata {
		return this.metadata;
	}

	// ============================================================================
	// Error Mapping
	// ============================================================================

	/**
	 * Maps HuggingFace errors to domain ML errors.
	 */
	private mapError(
		error: HuggingFaceError,
		operation: string,
	): MLProviderError {
		// Rate limit
		if (error instanceof HuggingFaceRateLimitError) {
			return new MLRateLimitError("huggingface", error.retryAfterMs);
		}

		// API error
		if (error instanceof HuggingFaceApiError) {
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

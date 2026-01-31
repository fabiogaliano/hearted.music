/**
 * DeepInfra ML Provider Adapter.
 *
 * Wraps the existing DeepInfra integration to conform to the MLProvider interface.
 * Maps DeepInfra-specific errors to domain ML errors.
 *
 * Models:
 * - Embedding: intfloat/multilingual-e5-large-instruct (1024 dims)
 * - Reranking: Qwen/Qwen3-Reranker-0.6B
 */

import { Result } from "better-result";
import * as deepinfra from "@/lib/integrations/deepinfra/service";
import {
	MLApiError,
	MLConfigError,
	type MLProviderError,
	MLProviderUnavailableError,
	MLRateLimitError,
	MLTimeoutError,
} from "@/lib/shared/errors/domain/ml";
import {
	DeepInfraApiError,
	DeepInfraRateLimitError,
} from "@/lib/shared/errors/external/deepinfra";
import type { MLProvider } from "../provider/ports";
import type {
	EmbeddingResult,
	EmbedOptions,
	ProviderMetadata,
	RerankOptions,
	RerankResult,
} from "../provider/types";

/**
 * DeepInfra provider adapter.
 */
export class DeepInfraProvider implements MLProvider {
	private readonly metadata: ProviderMetadata;

	constructor() {
		this.metadata = {
			name: "deepinfra",
			embeddingModel: deepinfra.getEmbeddingModel(),
			embeddingDims: deepinfra.getEmbeddingDims(),
			rerankerModel: "Qwen/Qwen3-Reranker-0.6B",
		};
	}

	async embed(
		text: string,
		options?: EmbedOptions,
	): Promise<Result<EmbeddingResult, MLProviderError>> {
		const result = await deepinfra.embedText(text, options);

		if (Result.isError(result)) {
			return Result.err(this.mapError(result.error, "embed"));
		}

		return Result.ok(result.value);
	}

	async embedBatch(
		texts: string[],
		options?: EmbedOptions,
	): Promise<Result<EmbeddingResult[], MLProviderError>> {
		const result = await deepinfra.embedBatch(texts, options);

		if (Result.isError(result)) {
			return Result.err(this.mapError(result.error, "embedBatch"));
		}

		return Result.ok(result.value);
	}

	async rerank(
		query: string,
		documents: string[],
		options?: RerankOptions,
	): Promise<Result<RerankResult, MLProviderError>> {
		const result = await deepinfra.rerank(query, documents, options);

		if (Result.isError(result)) {
			return Result.err(this.mapError(result.error, "rerank"));
		}

		return Result.ok(result.value);
	}

	async isAvailable(): Promise<boolean> {
		return deepinfra.isAvailable();
	}

	getMetadata(): ProviderMetadata {
		return this.metadata;
	}

	// ============================================================================
	// Error Mapping
	// ============================================================================

	/**
	 * Maps DeepInfra errors to domain ML errors.
	 */
	private mapError(
		error: DeepInfraApiError | DeepInfraRateLimitError,
		operation: string,
	): MLProviderError {
		// Rate limit
		if (error instanceof DeepInfraRateLimitError) {
			return new MLRateLimitError("deepinfra", error.retryAfterMs);
		}

		// API error
		if (error instanceof DeepInfraApiError) {
			// Timeout (no status code)
			if (!error.statusCode) {
				return new MLTimeoutError("deepinfra", operation, 30000);
			}

			// Unauthorized (missing or invalid API key)
			if (error.statusCode === 401 || error.statusCode === 403) {
				return new MLProviderUnavailableError(
					"deepinfra",
					"Missing or invalid API key",
				);
			}

			// Service unavailable
			if (error.statusCode === 503) {
				return new MLProviderUnavailableError(
					"deepinfra",
					"Service unavailable",
				);
			}

			// Generic API error
			return new MLApiError(
				"deepinfra",
				operation,
				error.message || "Unknown error",
				error.statusCode,
			);
		}

		// Unknown error type (should not happen)
		return new MLApiError("deepinfra", operation, "Unknown error");
	}
}

/**
 * Creates a DeepInfra provider instance.
 *
 * @throws {MLConfigError} if DEEPINFRA_API_KEY is not set
 */
export function createDeepInfraProvider(): Result<
	DeepInfraProvider,
	MLConfigError
> {
	const apiKey = process.env.DEEPINFRA_API_KEY;

	if (!apiKey) {
		return Result.err(
			new MLConfigError(
				"deepinfra",
				"DEEPINFRA_API_KEY",
				"Environment variable not set",
			),
		);
	}

	return Result.ok(new DeepInfraProvider());
}

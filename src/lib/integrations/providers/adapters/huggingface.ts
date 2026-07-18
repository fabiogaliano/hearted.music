/**
 * HuggingFace ML Provider Adapter.
 *
 * Conforms the HuggingFace Inference API (embeddings only, free tier) to the
 * MLProvider interface. Maps HuggingFace-specific errors to domain ML errors.
 *
 * Models:
 * - Embedding: sentence-transformers/all-MiniLM-L6-v2 (384 dims)
 * - Reranking: Not supported (graceful degradation)
 *
 * Note: HuggingFace API is free-tier friendly and works without HF_TOKEN,
 * but has lower rate limits than DeepInfra.
 */

import { InferenceClient } from "@huggingface/inference";
import { Result } from "better-result";
import { env } from "@/env";
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

// ============================================================================
// Configuration
// ============================================================================

/**
 * Model: sentence-transformers/all-MiniLM-L6-v2
 * - 384 dimensions (smaller than E5-large's 1024)
 * - Fast inference
 * - Free on HuggingFace
 * - Good for testing
 */
const HF_EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const HF_EMBEDDING_DIMS = 384;

interface HfEmbedOptions {
	/** Optional prefix for instruction-tuned models */
	prefix?: string;
}

interface HfEmbedResult {
	embedding: number[];
	dims: number;
}

// ============================================================================
// Client
// ============================================================================

let hfClient: InferenceClient | null = null;

function getClient(): InferenceClient {
	if (!hfClient) {
		// HF_TOKEN is optional - free tier works without it but has lower limits
		const token = env.HF_TOKEN;
		hfClient = new InferenceClient(token);
	}
	return hfClient;
}

// ============================================================================
// HuggingFace API calls
// ============================================================================

/**
 * Embeds a single text string.
 */
async function hfEmbedText(
	text: string,
	options?: HfEmbedOptions,
): Promise<Result<HfEmbedResult, HuggingFaceError>> {
	try {
		const client = getClient();
		const input = options?.prefix ? `${options.prefix} ${text}` : text;

		const response = await client.featureExtraction({
			model: HF_EMBEDDING_MODEL,
			inputs: input,
		});

		// HuggingFace returns number[] for single input
		const embedding = response as number[];

		return Result.ok({
			embedding,
			dims: embedding.length,
		});
	} catch (error) {
		if (error instanceof Error) {
			// Check for rate limit
			if (
				error.message.includes("rate limit") ||
				error.message.includes("429")
			) {
				return Result.err(new HuggingFaceRateLimitError(undefined));
			}

			return Result.err(
				new HuggingFaceApiError("huggingface/embed", undefined, error.message),
			);
		}

		return Result.err(
			new HuggingFaceApiError("huggingface/embed", undefined, "Unknown error"),
		);
	}
}

/**
 * Embeds multiple texts in a batch.
 * HuggingFace Inference API supports batch requests.
 */
async function hfEmbedBatch(
	texts: string[],
	options?: HfEmbedOptions,
): Promise<Result<HfEmbedResult[], HuggingFaceError>> {
	try {
		const client = getClient();
		const inputs = options?.prefix
			? texts.map((t) => `${options.prefix} ${t}`)
			: texts;

		const response = await client.featureExtraction({
			model: HF_EMBEDDING_MODEL,
			inputs,
		});

		// HuggingFace returns number[][] for batch input
		const embeddings = response as number[][];

		return Result.ok(
			embeddings.map((embedding) => ({
				embedding,
				dims: embedding.length,
			})),
		);
	} catch (error) {
		if (error instanceof Error) {
			// Check for rate limit
			if (
				error.message.includes("rate limit") ||
				error.message.includes("429")
			) {
				return Result.err(new HuggingFaceRateLimitError(undefined));
			}

			return Result.err(
				new HuggingFaceApiError(
					"huggingface/embed-batch",
					undefined,
					error.message,
				),
			);
		}

		return Result.err(
			new HuggingFaceApiError(
				"huggingface/embed-batch",
				undefined,
				"Unknown error",
			),
		);
	}
}

// ============================================================================
// MLProvider Adapter
// ============================================================================

/**
 * HuggingFace provider adapter.
 */
class HuggingFaceProvider implements MLProvider {
	private readonly metadata: ProviderMetadata;

	constructor() {
		this.metadata = {
			name: "huggingface",
			embeddingModel: HF_EMBEDDING_MODEL,
			embeddingDims: HF_EMBEDDING_DIMS,
			embeddingInstructionTuned: false, // MiniLM is symmetric
			rerankerModel: undefined, // No reranking support
		};
	}

	async embed(
		text: string,
		_options?: EmbedOptions,
	): Promise<Result<EmbeddingResult, MLProviderError>> {
		// MiniLM is symmetric (no instruct prefix), so the retrieval role is moot.
		const result = await hfEmbedText(text);

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
		const result = await hfEmbedBatch(texts);

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
		return true;
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

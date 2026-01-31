/**
 * HuggingFace Inference API integration for embeddings.
 *
 * Free tier with optional HF_TOKEN for higher rate limits.
 * Model: sentence-transformers/all-MiniLM-L6-v2 (384 dims, fast, free)
 *
 * Used for testing/development when DEEPINFRA_API_KEY is not available.
 */

import { InferenceClient } from "@huggingface/inference";
import { Result } from "better-result";
import { env } from "@/env";
import {
	DeepInfraApiError,
	DeepInfraRateLimitError,
} from "@/lib/shared/errors/external/deepinfra";

// ============================================================================
// Types
// ============================================================================

export interface EmbedOptions {
	/** Optional prefix for instruction-tuned models */
	prefix?: string;
}

export interface EmbedResult {
	embedding: number[];
	dims: number;
}

type HuggingFaceError = DeepInfraApiError | DeepInfraRateLimitError;

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
// Public API
// ============================================================================

/**
 * Gets the configured embedding model name.
 */
export function getEmbeddingModel(): string {
	return HF_EMBEDDING_MODEL;
}

/**
 * Gets the embedding dimensions.
 */
export function getEmbeddingDims(): number {
	return HF_EMBEDDING_DIMS;
}

/**
 * Checks if HuggingFace inference is available.
 * Always returns true (no API key required for free tier).
 */
export function isAvailable(): boolean {
	return true;
}

/**
 * Embeds a single text string.
 */
export async function embedText(
	text: string,
	options?: EmbedOptions,
): Promise<Result<EmbedResult, HuggingFaceError>> {
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
				return Result.err(new DeepInfraRateLimitError(undefined));
			}

			return Result.err(
				new DeepInfraApiError("huggingface/embed", undefined, error.message),
			);
		}

		return Result.err(
			new DeepInfraApiError("huggingface/embed", undefined, "Unknown error"),
		);
	}
}

/**
 * Embeds multiple texts in a batch.
 * HuggingFace Inference API supports batch requests.
 */
export async function embedBatch(
	texts: string[],
	options?: EmbedOptions,
): Promise<Result<EmbedResult[], HuggingFaceError>> {
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
				return Result.err(new DeepInfraRateLimitError(undefined));
			}

			return Result.err(
				new DeepInfraApiError(
					"huggingface/embed-batch",
					undefined,
					error.message,
				),
			);
		}

		return Result.err(
			new DeepInfraApiError(
				"huggingface/embed-batch",
				undefined,
				"Unknown error",
			),
		);
	}
}

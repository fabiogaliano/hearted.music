/**
 * DeepInfra Service - Embeddings and Reranking via DeepInfra API.
 *
 * Replaces the Python vectorization service with hosted models:
 * - Embeddings: intfloat/multilingual-e5-large-instruct (1024 dims)
 * - Reranking: Qwen/Qwen3-Reranker-0.6B
 *
 * Uses Result-based error handling for composable error flows.
 */

import { Result } from "better-result";
import { z } from "zod";
import {
	DeepInfraApiError,
	type DeepInfraError,
	DeepInfraRateLimitError,
} from "@/lib/shared/errors/external/deepinfra";

// ============================================================================
// Configuration
// ============================================================================

const EMBEDDING_URL = "https://api.deepinfra.com/v1/openai/embeddings";
const RERANKER_URL =
	"https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Reranker-0.6B";
const EMBEDDING_MODEL = "intfloat/multilingual-e5-large-instruct";
const EMBEDDING_DIMS = 1024;

/** Max texts per batch for embeddings (DeepInfra limit) */
const MAX_BATCH_SIZE = 96;

/** Default timeout for API calls */
const DEFAULT_TIMEOUT_MS = 30_000;

// ============================================================================
// Zod Schemas (single source of truth)
// ============================================================================

/** Embedding result with metadata */
export const EmbeddingResultSchema = z.object({
	embedding: z.array(z.number()),
	model: z.string(),
	dims: z.number(),
});
export type EmbeddingResult = z.infer<typeof EmbeddingResultSchema>;

/** Reranking result for a single document */
export const RerankScoreSchema = z.object({
	index: z.number(),
	score: z.number(),
});
export type RerankScore = z.infer<typeof RerankScoreSchema>;

/** Reranking result with metadata */
export const RerankResultSchema = z.object({
	scores: z.array(RerankScoreSchema),
	model: z.string(),
});
export type RerankResult = z.infer<typeof RerankResultSchema>;

/** E5 model prefix for optimal results */
export const EmbedPrefixSchema = z.enum(["query:", "passage:"]);
export type EmbedPrefix = z.infer<typeof EmbedPrefixSchema>;

/** Options for embedding operations */
export const EmbedOptionsSchema = z.object({
	/** Prefix for optimal results: "query:" for search, "passage:" for documents */
	prefix: EmbedPrefixSchema.optional(),
	/** Timeout in milliseconds */
	timeoutMs: z.number().positive().optional(),
});
export type EmbedOptions = z.infer<typeof EmbedOptionsSchema>;

/** Options for reranking operations */
export const RerankOptionsSchema = z.object({
	/** Maximum number of documents to return (0 = all) */
	topK: z.number().nonnegative().optional(),
	/** Timeout in milliseconds */
	timeoutMs: z.number().positive().optional(),
});
export type RerankOptions = z.infer<typeof RerankOptionsSchema>;

type DeepInfraServiceError = DeepInfraError;

// ============================================================================
// API Response Schemas (external API validation)
// ============================================================================

/** DeepInfra embedding API response */
const EmbeddingApiResponseSchema = z.object({
	object: z.literal("list"),
	data: z.array(
		z.object({
			object: z.literal("embedding"),
			index: z.number(),
			embedding: z.array(z.number()),
		}),
	),
	model: z.string(),
	usage: z.object({
		prompt_tokens: z.number(),
		total_tokens: z.number(),
	}),
});

/** DeepInfra reranker API response */
const RerankApiResponseSchema = z.object({
	results: z.array(
		z.object({
			index: z.number(),
			relevance_score: z.number(),
		}),
	),
});

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Gets the DeepInfra API key from environment.
 */
function getApiKey(): string {
	const key = process.env.DEEPINFRA_API_KEY;
	if (!key) {
		throw new Error("DEEPINFRA_API_KEY environment variable not set");
	}
	return key;
}

/**
 * Embeds a single text string.
 *
 * @param text - Text to embed
 * @param options - Embedding options (prefix, timeout)
 * @returns Result containing embedding vector or error
 */
export async function embedText(
	text: string,
	options: EmbedOptions = {},
): Promise<Result<EmbeddingResult, DeepInfraServiceError>> {
	const result = await embedBatch([text], options);
	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	return Result.ok(result.value[0]);
}

/**
 * Embeds multiple texts in a batch.
 *
 * @param texts - Array of texts to embed
 * @param options - Embedding options (prefix, timeout)
 * @returns Result containing array of embedding results or error
 */
export async function embedBatch(
	texts: string[],
	options: EmbedOptions = {},
): Promise<Result<EmbeddingResult[], DeepInfraServiceError>> {
	if (texts.length === 0) {
		return Result.ok([]);
	}

	const { prefix = "passage:", timeoutMs = DEFAULT_TIMEOUT_MS } = options;

	// Process in chunks if exceeding max batch size
	if (texts.length > MAX_BATCH_SIZE) {
		return processBatchChunks(texts, options);
	}

	// Apply prefix for optimal results with E5 models
	const prefixedTexts = texts.map((t) => `${prefix} ${t}`);

	try {
		const response = await fetch(EMBEDDING_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${getApiKey()}`,
			},
			body: JSON.stringify({
				input: prefixedTexts,
				model: EMBEDDING_MODEL,
				encoding_format: "float",
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});

		if (!response.ok) {
			return handleErrorResponse(response, "embeddings");
		}

		const rawData = await response.json();
		const parseResult = EmbeddingApiResponseSchema.safeParse(rawData);
		if (!parseResult.success) {
			return Result.err(
				new DeepInfraApiError(
					"embeddings",
					undefined,
					`Invalid API response: ${parseResult.error.message}`,
				),
			);
		}
		const data = parseResult.data;

		// Sort by index to ensure order matches input
		const sortedData = [...data.data].sort((a, b) => a.index - b.index);

		const results: EmbeddingResult[] = sortedData.map((item) => ({
			embedding: item.embedding,
			model: data.model,
			dims: item.embedding.length,
		}));

		return Result.ok(results);
	} catch (error) {
		if (error instanceof Error && error.name === "TimeoutError") {
			return Result.err(
				new DeepInfraApiError("embeddings", undefined, "Request timed out"),
			);
		}
		return Result.err(
			new DeepInfraApiError(
				"embeddings",
				undefined,
				error instanceof Error ? error.message : "Unknown error",
			),
		);
	}
}

/**
 * Reranks documents based on relevance to a query.
 *
 * @param query - Query text to rank against
 * @param documents - Documents to rerank
 * @param options - Reranking options (topK, timeout)
 * @returns Result containing rerank scores or error
 */
export async function rerank(
	query: string,
	documents: string[],
	options: RerankOptions = {},
): Promise<Result<RerankResult, DeepInfraServiceError>> {
	if (documents.length === 0) {
		return Result.ok({ scores: [], model: "Qwen/Qwen3-Reranker-0.6B" });
	}

	const { topK = 0, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

	try {
		const response = await fetch(RERANKER_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${getApiKey()}`,
			},
			body: JSON.stringify({
				query,
				documents,
				return_documents: false,
				...(topK > 0 && { top_n: topK }),
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});

		if (!response.ok) {
			return handleErrorResponse(response, "rerank");
		}

		const rawData = await response.json();
		const parseResult = RerankApiResponseSchema.safeParse(rawData);
		if (!parseResult.success) {
			return Result.err(
				new DeepInfraApiError(
					"rerank",
					undefined,
					`Invalid API response: ${parseResult.error.message}`,
				),
			);
		}
		const data = parseResult.data;

		const scores: RerankScore[] = data.results.map((item) => ({
			index: item.index,
			score: item.relevance_score,
		}));

		// Sort by score descending
		scores.sort((a, b) => b.score - a.score);

		return Result.ok({
			scores,
			model: "Qwen/Qwen3-Reranker-0.6B",
		});
	} catch (error) {
		if (error instanceof Error && error.name === "TimeoutError") {
			return Result.err(
				new DeepInfraApiError("rerank", undefined, "Request timed out"),
			);
		}
		return Result.err(
			new DeepInfraApiError(
				"rerank",
				undefined,
				error instanceof Error ? error.message : "Unknown error",
			),
		);
	}
}

/**
 * Checks if the DeepInfra service is available.
 *
 * @returns true if the API key is set and a test request succeeds
 */
export async function isAvailable(): Promise<boolean> {
	try {
		getApiKey();
		// Simple test embedding
		const result = await embedText("test", { timeoutMs: 5000 });
		return Result.isOk(result);
	} catch {
		return false;
	}
}

/**
 * Gets the expected embedding dimensions.
 */
export function getEmbeddingDims(): number {
	return EMBEDDING_DIMS;
}

/**
 * Gets the embedding model name.
 */
export function getEmbeddingModel(): string {
	return EMBEDDING_MODEL;
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function processBatchChunks(
	texts: string[],
	options: EmbedOptions,
): Promise<Result<EmbeddingResult[], DeepInfraServiceError>> {
	const results: EmbeddingResult[] = [];

	for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
		const chunk = texts.slice(i, i + MAX_BATCH_SIZE);
		const chunkResult = await embedBatch(chunk, options);

		if (Result.isError(chunkResult)) {
			return Result.err(chunkResult.error);
		}

		results.push(...chunkResult.value);
	}

	return Result.ok(results);
}

async function handleErrorResponse<T>(
	response: Response,
	endpoint: string,
): Promise<Result<T, DeepInfraServiceError>> {
	if (response.status === 429) {
		const retryAfter = response.headers.get("Retry-After");
		const retryAfterMs = retryAfter
			? Number.parseInt(retryAfter) * 1000
			: undefined;
		return Result.err(new DeepInfraRateLimitError(retryAfterMs));
	}

	let detail: string | undefined;
	try {
		const errorBody = await response.json();
		detail =
			errorBody.error?.message ||
			errorBody.message ||
			JSON.stringify(errorBody);
	} catch {
		detail = response.statusText;
	}

	return Result.err(new DeepInfraApiError(endpoint, response.status, detail));
}

/**
 * DeepInfra ML Provider Adapter.
 *
 * Conforms the DeepInfra API (embeddings + reranking) to the MLProvider
 * interface. Maps DeepInfra-specific errors to domain ML errors.
 *
 * Models:
 * - Embedding: Qwen/Qwen3-Embedding-0.6B (Matryoshka-truncated to 512 dims)
 * - Reranking: Qwen/Qwen3-Reranker-0.6B
 */

import { Result } from "better-result";
import { z } from "zod";
import { env } from "@/env";
import {
	EMBEDDING_ROLES,
	formatEmbeddingInput,
	truncateAndNormalize,
} from "@/lib/integrations/embedding/format";
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
	type DeepInfraError,
	DeepInfraRateLimitError,
} from "@/lib/shared/errors/external/deepinfra";
import { ConcurrencyLimiter } from "@/lib/shared/utils/concurrency";
import type { MLProvider } from "../ports";
import {
	DEFAULT_RERANK_INSTRUCTION,
	type EmbeddingResult,
	type EmbedOptions,
	type ProviderMetadata,
	type RerankOptions,
	type RerankResult,
} from "../types";

// ============================================================================
// Configuration
// ============================================================================

const EMBEDDING_URL = "https://api.deepinfra.com/v1/openai/embeddings";
const RERANKER_MODEL = "Qwen/Qwen3-Reranker-0.6B";
const EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-0.6B";
// Qwen3-Embedding is instruction-tuned: queries take the Instruct/Query
// wrapper, documents none. See @/lib/integrations/embedding/format.
const EMBEDDING_INSTRUCTION_TUNED = true;
// MRL target. The model returns up to 1024 dims; we truncate + renormalize
// client-side to 512 (cost-identical — embeddings are priced per input token,
// not per output dim) and store 512 in pgvector.
const EMBEDDING_DIMS = 512;

/** Max texts per batch for embeddings (DeepInfra limit) */
const MAX_BATCH_SIZE = 96;

/** Default timeout for API calls */
const DEFAULT_TIMEOUT_MS = 30_000;

// Shared across all callers so concurrent worker jobs respect a single rate limit
const sharedLimiter = new ConcurrencyLimiter(10, 20, 100);

// ============================================================================
// Zod Schemas (single source of truth)
// ============================================================================

/** Embedding result with metadata */
const EmbeddingResultSchema = z.object({
	embedding: z.array(z.number()),
	model: z.string(),
	dims: z.number(),
});
type DeepInfraEmbeddingResult = z.infer<typeof EmbeddingResultSchema>;

/** Reranking result for a single document */
const RerankScoreSchema = z.object({
	index: z.number(),
	score: z.number(),
});

/** Reranking result with metadata */
const RerankResultSchema = z.object({
	scores: z.array(RerankScoreSchema),
	model: z.string(),
});
type DeepInfraRerankResult = z.infer<typeof RerankResultSchema>;

/** Retrieval role — selects the instruct format applied to the input */
const EmbedRoleSchema = z.enum(EMBEDDING_ROLES);

/** Options for embedding operations */
const EmbedOptionsSchema = z.object({
	/** Retrieval role: "query" for search intent, "passage" for documents */
	role: EmbedRoleSchema.optional(),
	/** Timeout in milliseconds */
	timeoutMs: z.number().positive().optional(),
});
type DeepInfraEmbedOptions = z.infer<typeof EmbedOptionsSchema>;

/** Options for reranking operations */
const RerankOptionsSchema = z.object({
	/** Maximum number of documents to return (0 = all) */
	topK: z.number().nonnegative().optional(),
	/** Timeout in milliseconds */
	timeoutMs: z.number().positive().optional(),
	/** Task-specific instruction forwarded to the model */
	instruction: z.string().optional(),
	/** Reranker model id — defaults to RERANKER_MODEL */
	model: z.string().optional(),
});
type DeepInfraRerankOptions = z.infer<typeof RerankOptionsSchema>;

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

/** DeepInfra reranker API response — Shape B (Qwen3-Reranker contract) */
const RerankApiResponseSchema = z.object({
	scores: z.array(z.number()),
	input_tokens: z.number().optional(),
	request_id: z.string().nullable().optional(),
	inference_status: z
		.looseObject({
			status: z.string().optional(),
			runtime_ms: z.number().optional(),
			cost: z.number().optional(),
			tokens_generated: z.number().optional(),
			tokens_input: z.number().optional(),
			output_length: z.number().optional(),
		})
		.optional(),
});

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Gets the DeepInfra API key from environment.
 */
function getApiKey(): string {
	const key = env.DEEPINFRA_API_KEY;
	if (!key) {
		throw new Error("DEEPINFRA_API_KEY environment variable not set");
	}
	return key;
}

/**
 * Embeds a single text string.
 */
async function embedText(
	text: string,
	options: DeepInfraEmbedOptions = {},
): Promise<Result<DeepInfraEmbeddingResult, DeepInfraServiceError>> {
	const result = await embedBatch([text], options);
	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	return Result.ok(result.value[0]);
}

/**
 * Embeds multiple texts in a batch.
 */
async function embedBatch(
	texts: string[],
	options: DeepInfraEmbedOptions = {},
): Promise<Result<DeepInfraEmbeddingResult[], DeepInfraServiceError>> {
	if (texts.length === 0) {
		return Result.ok([]);
	}

	const { role = "passage", timeoutMs = DEFAULT_TIMEOUT_MS } = options;

	// Process in chunks if exceeding max batch size
	if (texts.length > MAX_BATCH_SIZE) {
		return processBatchChunks(texts, options);
	}

	const formattedTexts = texts.map((t) =>
		formatEmbeddingInput(t, role, EMBEDDING_INSTRUCTION_TUNED),
	);

	return sharedLimiter.run(async () => {
		try {
			const response = await fetch(EMBEDDING_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${getApiKey()}`,
				},
				body: JSON.stringify({
					input: formattedTexts,
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

			const sortedData = data.data.toSorted((a, b) => a.index - b.index);

			const results: DeepInfraEmbeddingResult[] = sortedData.map((item) => {
				const embedding = truncateAndNormalize(item.embedding, EMBEDDING_DIMS);
				return {
					embedding,
					model: data.model,
					dims: embedding.length,
				};
			});

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
	});
}

/**
 * Reranks documents based on relevance to a query.
 */
async function rerank(
	query: string,
	documents: string[],
	options: DeepInfraRerankOptions = {},
): Promise<Result<DeepInfraRerankResult, DeepInfraServiceError>> {
	const model = options.model ?? RERANKER_MODEL;

	if (documents.length === 0) {
		return Result.ok({ scores: [], model });
	}

	// Canonical fallback so direct callers (bypassing RerankerService) score
	// with the same instruction as production. The field is in DeepInfra's
	// documented input schema; acceptance still needs the live smoke test.
	const {
		timeoutMs = DEFAULT_TIMEOUT_MS,
		instruction = DEFAULT_RERANK_INSTRUCTION,
	} = options;

	const rerankerUrl = `https://api.deepinfra.com/v1/inference/${model}`;

	return sharedLimiter.run(async () => {
		try {
			const response = await fetch(rerankerUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${getApiKey()}`,
				},
				body: JSON.stringify({
					queries: Array(documents.length).fill(query),
					documents,
					instruction,
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

			// scores[i] is positional — index is the document's original position
			const scores = data.scores.map((score, index) => ({
				index,
				score,
			}));

			return Result.ok({
				scores: scores.toSorted((a, b) => b.score - a.score),
				model,
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
	});
}

/**
 * Checks if the DeepInfra service is available.
 */
async function deepInfraIsAvailable(): Promise<boolean> {
	try {
		getApiKey();
		// Simple test embedding
		const result = await embedText("test", { timeoutMs: 5000 });
		return Result.isOk(result);
	} catch {
		return false;
	}
}

async function processBatchChunks(
	texts: string[],
	options: DeepInfraEmbedOptions,
): Promise<Result<DeepInfraEmbeddingResult[], DeepInfraServiceError>> {
	const results: DeepInfraEmbeddingResult[] = [];

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
			? Number.parseInt(retryAfter, 10) * 1000
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

// ============================================================================
// MLProvider Adapter
// ============================================================================

/**
 * DeepInfra provider adapter.
 */
class DeepInfraProvider implements MLProvider {
	private readonly metadata: ProviderMetadata;

	constructor() {
		this.metadata = {
			name: "deepinfra",
			embeddingModel: EMBEDDING_MODEL,
			embeddingDims: EMBEDDING_DIMS,
			embeddingInstructionTuned: EMBEDDING_INSTRUCTION_TUNED,
			rerankerModel: RERANKER_MODEL,
		};
	}

	async embed(
		text: string,
		options?: EmbedOptions,
	): Promise<Result<EmbeddingResult, MLProviderError>> {
		const result = await embedText(text, options);

		if (Result.isError(result)) {
			return Result.err(this.mapError(result.error, "embed"));
		}

		return Result.ok(result.value);
	}

	async embedBatch(
		texts: string[],
		options?: EmbedOptions,
	): Promise<Result<EmbeddingResult[], MLProviderError>> {
		const result = await embedBatch(texts, options);

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
		const result = await rerank(query, documents, options);

		if (Result.isError(result)) {
			return Result.err(this.mapError(result.error, "rerank"));
		}

		return Result.ok(result.value);
	}

	async isAvailable(): Promise<boolean> {
		return deepInfraIsAvailable();
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
	const apiKey = env.DEEPINFRA_API_KEY;

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

/**
 * Local ML Provider Adapter (Development Only).
 *
 * Uses @huggingface/transformers for local model inference.
 * Requires dynamic import to avoid bundling heavy dependencies in production.
 *
 * IMPORTANT: This adapter is gated by ML_PROVIDER=local environment variable
 * and should only be used in development. Production builds should not
 * include this adapter to avoid bundle size bloat.
 *
 * Models:
 * - Embedding: Xenova/all-MiniLM-L6-v2 (384 dims, ~50MB download)
 * - Reranking: Xenova/bge-reranker-base (~100MB download, first run only)
 *
 * Note: Models are cached after first download. Initial inference will be slow
 * as models are downloaded and loaded into memory.
 */

import { Result } from "better-result";
import {
	MLApiError,
	MLConfigError,
	type MLProviderError,
	MLProviderUnavailableError,
	MLTimeoutError,
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
 * Local provider adapter using HuggingFace Transformers.js.
 *
 * This adapter dynamically imports @huggingface/transformers to avoid
 * bundling it in production builds.
 */
export class LocalProvider implements MLProvider {
	private readonly metadata: ProviderMetadata;
	private embeddingPipeline: Promise<any> | null = null;
	private rerankerPipeline: Promise<any> | null = null;

	constructor() {
		this.metadata = {
			name: "local",
			embeddingModel: "Xenova/all-MiniLM-L6-v2",
			embeddingDims: 384,
			rerankerModel: "Xenova/bge-reranker-base",
		};
	}

	/**
	 * Lazy-loads the embedding pipeline.
	 */
	private async getEmbeddingPipeline(): Promise<any> {
		if (!this.embeddingPipeline) {
			this.embeddingPipeline = (async () => {
				try {
					// Dynamic import to avoid bundling in production
					const { pipeline } = await import("@huggingface/transformers");
					console.log(`[Local Provider] Loading embedding model: ${this.metadata.embeddingModel}`);
					return await pipeline("feature-extraction", this.metadata.embeddingModel);
				} catch (error) {
					throw new Error(
						`Failed to load embedding model: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			})();
		}
		return this.embeddingPipeline;
	}

	/**
	 * Lazy-loads the reranker pipeline.
	 *
	 * Note: First load will download ~100MB model. Subsequent calls use cached model.
	 */
	private async getRerankerPipeline(): Promise<any> {
		if (!this.rerankerPipeline) {
			this.rerankerPipeline = (async () => {
				try {
					const { pipeline } = await import("@huggingface/transformers");
					console.log(`[Local Provider] Loading reranker model: ${this.metadata.rerankerModel} (~100MB, first time only)`);
					return await pipeline(
						"text-classification",
						this.metadata.rerankerModel,
					);
				} catch (error) {
					throw new Error(
						`Failed to load reranker model: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			})();
		}
		return this.rerankerPipeline;
	}

	async embed(
		text: string,
		options?: EmbedOptions,
	): Promise<Result<EmbeddingResult, MLProviderError>> {
		try {
			const pipe = await this.getEmbeddingPipeline();
			const input = options?.prefix ? `${options.prefix} ${text}` : text;

			// Run inference
			const output = await pipe(input, {
				pooling: "mean",
				normalize: true,
			});

			// Extract embedding array
			const embedding = Array.from(output.data as Float32Array);

			return Result.ok({
				embedding,
				model: this.metadata.embeddingModel,
				dims: embedding.length,
			});
		} catch (error) {
			if (error instanceof Error) {
				// Check for timeout-like errors
				if (error.message.includes("timeout") || error.message.includes("timed out")) {
					return Result.err(
						new MLTimeoutError("local", "embed", 30000),
					);
				}

				// Model loading failure
				if (error.message.includes("Failed to load")) {
					return Result.err(
						new MLProviderUnavailableError("local", error.message),
					);
				}

				return Result.err(
					new MLApiError("local", "embed", error.message),
				);
			}

			return Result.err(
				new MLApiError("local", "embed", "Unknown error"),
			);
		}
	}

	async embedBatch(
		texts: string[],
		options?: EmbedOptions,
	): Promise<Result<EmbeddingResult[], MLProviderError>> {
		try {
			const pipe = await this.getEmbeddingPipeline();
			const inputs = options?.prefix
				? texts.map((t) => `${options.prefix} ${t}`)
				: texts;

			// Run batch inference
			const output = await pipe(inputs, {
				pooling: "mean",
				normalize: true,
			});

			// Extract embeddings
			const results: EmbeddingResult[] = [];
			for (let i = 0; i < texts.length; i++) {
				const embedding = Array.from(output[i].data as Float32Array);
				results.push({
					embedding,
					model: this.metadata.embeddingModel,
					dims: embedding.length,
				});
			}

			return Result.ok(results);
		} catch (error) {
			if (error instanceof Error) {
				// Check for timeout-like errors
				if (error.message.includes("timeout") || error.message.includes("timed out")) {
					return Result.err(
						new MLTimeoutError("local", "embedBatch", 30000),
					);
				}

				// Model loading failure
				if (error.message.includes("Failed to load")) {
					return Result.err(
						new MLProviderUnavailableError("local", error.message),
					);
				}

				return Result.err(
					new MLApiError("local", "embedBatch", error.message),
				);
			}

			return Result.err(
				new MLApiError("local", "embedBatch", "Unknown error"),
			);
		}
	}

	async rerank(
		query: string,
		documents: string[],
		options?: RerankOptions,
	): Promise<Result<RerankResult, MLProviderError>> {
		if (documents.length === 0) {
			return Result.ok({
				scores: [],
				model: this.metadata.rerankerModel!,
			});
		}

		try {
			const pipe = await this.getRerankerPipeline();

			// Create query-document pairs for the reranker
			// Format: "[CLS] query [SEP] document [SEP]"
			const pairs = documents.map((doc) => `${query} ${doc}`);

			// Run reranking inference
			const results = await pipe(pairs);

			// Extract scores and map to our format
			const scores = (Array.isArray(results) ? results : [results]).map(
				(result: any, index: number) => ({
					index,
					// Reranker returns classification scores; use the "positive" class score
					score: Array.isArray(result)
						? result[0]?.score ?? 0
						: result.score ?? 0,
				}),
			);

			// Sort by score descending (highest relevance first)
			scores.sort((a, b) => b.score - a.score);

			// Apply topK filtering if specified
			const topK = options?.topK ?? 0;
			const finalScores = topK > 0 ? scores.slice(0, topK) : scores;

			return Result.ok({
				scores: finalScores,
				model: this.metadata.rerankerModel!,
			});
		} catch (error) {
			if (error instanceof Error) {
				// Check for timeout-like errors
				if (error.message.includes("timeout") || error.message.includes("timed out")) {
					return Result.err(
						new MLTimeoutError("local", "rerank", 30000),
					);
				}

				// Model loading failure
				if (error.message.includes("Failed to load")) {
					return Result.err(
						new MLProviderUnavailableError("local", error.message),
					);
				}

				return Result.err(
					new MLApiError("local", "rerank", error.message),
				);
			}

			return Result.err(
				new MLApiError("local", "rerank", "Unknown error"),
			);
		}
	}

	async isAvailable(): Promise<boolean> {
		try {
			// Check if embedding pipeline can be loaded
			await this.getEmbeddingPipeline();
			return true;
		} catch {
			return false;
		}
	}

	getMetadata(): ProviderMetadata {
		return this.metadata;
	}
}

/**
 * Creates a local provider instance.
 *
 * @returns Result containing provider or error if not in local mode
 */
export function createLocalProvider(): Result<LocalProvider, MLConfigError> {
	const mlProvider = process.env.ML_PROVIDER;

	if (mlProvider !== "local") {
		return Result.err(
			new MLConfigError(
				"local",
				"ML_PROVIDER",
				"Local provider requires ML_PROVIDER=local environment variable",
			),
		);
	}

	return Result.ok(new LocalProvider());
}

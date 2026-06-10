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
 * - Embedding: Qwen/Qwen3-Embedding-0.6B via the onnx-community ONNX export
 *   (last-token pooling, fp32, MRL-truncated to 512 dims)
 * - Reranking: Xenova/bge-reranker-base (~100MB download, first run only)
 *
 * NOTE: production embeds via DeepInfra; this in-process path is for local dev.
 * The fp32 Qwen3 weights are a ~2.4GB first-time download (then cached). Vectors
 * are truncated + renormalized to 512 dims to match the pgvector column.
 *
 * Runtime modes:
 * - "direct": ONNX loaded in-process (Bun scripts, Node)
 * - "http": Delegates to embedding sidecar (Workerd / Vite dev server)
 *
 * Note: Models are cached after first download. Initial inference will be slow
 * as models are downloaded and loaded into memory.
 */

import { Result } from "better-result";
import { env } from "@/env";
import {
	formatEmbeddingInput,
	truncateAndNormalize,
} from "@/lib/integrations/embedding/format";
import {
	MLApiError,
	MLConfigError,
	type MLProviderError,
	MLProviderUnavailableError,
	MLTimeoutError,
	MLUnsupportedOperationError,
} from "@/lib/shared/errors/domain/ml";
import type { MLProvider } from "../ports";
import type {
	EmbeddingResult,
	EmbedOptions,
	ProviderMetadata,
	RerankOptions,
	RerankResult,
} from "../types";

const HTTP_TIMEOUT_MS = 120_000;

// The official Qwen repo ships no ONNX export, so transformers.js loads the
// community conversion. Vectors are stored under the canonical model name
// (metadata.embeddingModel) so they share a cache key with the DeepInfra path.
const EMBEDDING_ONNX_REPO = "onnx-community/Qwen3-Embedding-0.6B-ONNX";
// fp32 matches the hosted model most closely; the ~2.4GB fp32 weights are
// external ONNX data, which transformers.js only fetches when this flag is set.
const EMBEDDING_PIPELINE_OPTIONS = {
	dtype: "fp32",
	use_external_data_format: true,
} as const;

// Qwen3-Embedding is instruction-tuned (see @/lib/integrations/embedding/format)
// and pools the final token's hidden state — NOT mean pooling (that was E5).
const EMBEDDING_INSTRUCTION_TUNED = true;
const EMBEDDING_POOLING = "last_token" as const;
const EMBEDDING_DIMS = 512;

export class LocalProvider implements MLProvider {
	private readonly metadata: ProviderMetadata;
	private embeddingPipeline: Promise<any> | null = null;
	private rerankerPipeline: Promise<any> | null = null;
	private mode: "direct" | "http" | "unknown" = "unknown";
	private readonly serverBaseUrl: string;
	private resolveModePromise: Promise<void> | null = null;

	constructor(options?: { forceDirect?: boolean }) {
		this.metadata = {
			name: "local",
			embeddingModel: "Qwen/Qwen3-Embedding-0.6B",
			embeddingDims: EMBEDDING_DIMS,
			embeddingInstructionTuned: EMBEDDING_INSTRUCTION_TUNED,
			rerankerModel: "Xenova/bge-reranker-base",
		};
		// biome-ignore lint/style/noProcessEnv: dev-only local embedding sidecar port, intentionally not part of validated env
		const port = process.env.EMBEDDING_SERVER_PORT || "9847";
		this.serverBaseUrl = `http://127.0.0.1:${port}`;
		if (options?.forceDirect) this.mode = "direct";
	}

	private async resolveMode(): Promise<void> {
		if (this.mode !== "unknown") return;

		if (!this.resolveModePromise) {
			this.resolveModePromise = (async () => {
				// Check sidecar first — avoids expensive ONNX probe in Workerd
				try {
					const res = await fetch(`${this.serverBaseUrl}/health`, {
						signal: AbortSignal.timeout(1000),
					});
					if (res.ok) {
						this.mode = "http";
						console.log(
							`[Local Provider] Using embedding sidecar at ${this.serverBaseUrl}`,
						);
						return;
					}
				} catch {
					// Sidecar not running — fall through to direct ONNX
				}

				try {
					const { pipeline } = await import("@huggingface/transformers");
					console.log(
						`[Local Provider] Loading embedding model: ${EMBEDDING_ONNX_REPO}`,
					);
					const pipe = await pipeline(
						"feature-extraction",
						EMBEDDING_ONNX_REPO,
						EMBEDDING_PIPELINE_OPTIONS,
					);
					this.embeddingPipeline = Promise.resolve(pipe);
					this.mode = "direct";
					console.log("[Local Provider] Mode: direct (ONNX in-process)");
				} catch {
					throw new MLProviderUnavailableError(
						"local",
						"ONNX unavailable and embedding sidecar not running. Start it with: bun run dev:embeddings",
					);
				}
			})();
		}

		try {
			await this.resolveModePromise;
		} catch (error) {
			// Reset so next call can retry
			this.resolveModePromise = null;
			throw error;
		}
	}

	/**
	 * Lazy-loads the embedding pipeline (direct mode only).
	 */
	private async getEmbeddingPipeline(): Promise<any> {
		await this.resolveMode();
		if (this.mode === "http") return null;

		if (!this.embeddingPipeline) {
			this.embeddingPipeline = (async () => {
				try {
					const { pipeline } = await import("@huggingface/transformers");
					console.log(
						`[Local Provider] Loading embedding model: ${EMBEDDING_ONNX_REPO}`,
					);
					return await pipeline(
						"feature-extraction",
						EMBEDDING_ONNX_REPO,
						EMBEDDING_PIPELINE_OPTIONS,
					);
				} catch (error) {
					this.embeddingPipeline = null;
					throw new Error(
						`Failed to load embedding model: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			})();
		}
		return this.embeddingPipeline;
	}

	/**
	 * Lazy-loads the reranker pipeline (direct mode only).
	 *
	 * Note: First load will download ~100MB model. Subsequent calls use cached model.
	 */
	private async getRerankerPipeline(): Promise<any> {
		await this.resolveMode();
		if (this.mode === "http") return null;

		if (!this.rerankerPipeline) {
			this.rerankerPipeline = (async () => {
				try {
					const { pipeline } = await import("@huggingface/transformers");
					console.log(
						`[Local Provider] Loading reranker model: ${this.metadata.rerankerModel} (~100MB, first time only)`,
					);
					return await pipeline(
						"text-classification",
						this.metadata.rerankerModel,
					);
				} catch (error) {
					this.rerankerPipeline = null;
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

			if (this.mode === "http") {
				return this.embedViaHttp(text, options);
			}

			const input = formatEmbeddingInput(
				text,
				options?.role ?? "passage",
				EMBEDDING_INSTRUCTION_TUNED,
			);
			const output = await pipe(input, {
				pooling: EMBEDDING_POOLING,
				normalize: true,
			});

			const embedding = truncateAndNormalize(
				Array.from(output.data as Float32Array),
				EMBEDDING_DIMS,
			);

			return Result.ok({
				embedding,
				model: this.metadata.embeddingModel,
				dims: embedding.length,
			});
		} catch (error) {
			return this.mapDirectError(error, "embed");
		}
	}

	async embedBatch(
		texts: string[],
		options?: EmbedOptions,
	): Promise<Result<EmbeddingResult[], MLProviderError>> {
		try {
			const pipe = await this.getEmbeddingPipeline();

			if (this.mode === "http") {
				return this.embedBatchViaHttp(texts, options);
			}

			const role = options?.role ?? "passage";
			const inputs = texts.map((t) =>
				formatEmbeddingInput(t, role, EMBEDDING_INSTRUCTION_TUNED),
			);

			const output = await pipe(inputs, {
				pooling: EMBEDDING_POOLING,
				normalize: true,
			});

			const results: EmbeddingResult[] = [];
			for (let i = 0; i < texts.length; i++) {
				const embedding = truncateAndNormalize(
					Array.from(output[i].data as Float32Array),
					EMBEDDING_DIMS,
				);
				results.push({
					embedding,
					model: this.metadata.embeddingModel,
					dims: embedding.length,
				});
			}

			return Result.ok(results);
		} catch (error) {
			return this.mapDirectError(error, "embedBatch");
		}
	}

	async rerank(
		query: string,
		documents: string[],
		options?: RerankOptions,
	): Promise<Result<RerankResult, MLProviderError>> {
		const model = this.metadata.rerankerModel;
		if (!model) {
			return Result.err(new MLUnsupportedOperationError("local", "rerank"));
		}

		if (documents.length === 0) {
			return Result.ok({ scores: [], model });
		}

		try {
			const pipe = await this.getRerankerPipeline();

			if (this.mode === "http") {
				return this.rerankViaHttp(query, documents, options);
			}

			const pairs = documents.map((doc) => `${query} ${doc}`);
			const results = await pipe(pairs);

			const scores = (Array.isArray(results) ? results : [results]).map(
				(result: any, index: number) => ({
					index,
					score: Array.isArray(result)
						? (result[0]?.score ?? 0)
						: (result.score ?? 0),
				}),
			);

			const sorted = scores.toSorted((a, b) => b.score - a.score);

			const topK = options?.topK ?? 0;
			const finalScores = topK > 0 ? sorted.slice(0, topK) : sorted;

			return Result.ok({ scores: finalScores, model });
		} catch (error) {
			return this.mapDirectError(error, "rerank");
		}
	}

	async isAvailable(): Promise<boolean> {
		try {
			await this.resolveMode();

			if (this.mode === "http") {
				const res = await fetch(`${this.serverBaseUrl}/health`, {
					signal: AbortSignal.timeout(3000),
				});
				return res.ok;
			}

			await this.getEmbeddingPipeline();
			return true;
		} catch {
			return false;
		}
	}

	getMetadata(): ProviderMetadata {
		return this.metadata;
	}

	// -- HTTP helpers (sidecar delegation) ------------------------------------

	private async embedViaHttp(
		text: string,
		options?: EmbedOptions,
	): Promise<Result<EmbeddingResult, MLProviderError>> {
		try {
			const res = await fetch(`${this.serverBaseUrl}/embed`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text, options }),
				signal: AbortSignal.timeout(options?.timeoutMs ?? HTTP_TIMEOUT_MS),
			});
			return this.parseHttpResponse<EmbeddingResult>(res, "embed");
		} catch (error) {
			return Result.err(this.mapHttpError(error, "embed"));
		}
	}

	private async embedBatchViaHttp(
		texts: string[],
		options?: EmbedOptions,
	): Promise<Result<EmbeddingResult[], MLProviderError>> {
		try {
			const res = await fetch(`${this.serverBaseUrl}/embed-batch`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ texts, options }),
				signal: AbortSignal.timeout(options?.timeoutMs ?? HTTP_TIMEOUT_MS),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				const msg = body?.error ?? `HTTP ${res.status}`;
				return Result.err(this.mapHttpErrorTag(body?.tag, msg, "embedBatch"));
			}
			const body = await res.json();
			return Result.ok(body.results as EmbeddingResult[]);
		} catch (error) {
			return Result.err(this.mapHttpError(error, "embedBatch"));
		}
	}

	private async rerankViaHttp(
		query: string,
		documents: string[],
		options?: RerankOptions,
	): Promise<Result<RerankResult, MLProviderError>> {
		try {
			const res = await fetch(`${this.serverBaseUrl}/rerank`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query, documents, options }),
				signal: AbortSignal.timeout(options?.timeoutMs ?? HTTP_TIMEOUT_MS),
			});
			return this.parseHttpResponse<RerankResult>(res, "rerank");
		} catch (error) {
			return Result.err(this.mapHttpError(error, "rerank"));
		}
	}

	private async parseHttpResponse<T>(
		res: Response,
		operation: string,
	): Promise<Result<T, MLProviderError>> {
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			const msg = body?.error ?? `HTTP ${res.status}`;
			return Result.err(this.mapHttpErrorTag(body?.tag, msg, operation));
		}
		try {
			const data = await res.json();
			return Result.ok(data as T);
		} catch {
			return Result.err(
				new MLApiError(
					"local",
					operation,
					"Invalid response from embedding sidecar",
				),
			);
		}
	}

	private mapHttpError(error: unknown, operation: string): MLProviderError {
		if (error instanceof DOMException && error.name === "TimeoutError") {
			return new MLTimeoutError("local", operation, HTTP_TIMEOUT_MS);
		}
		if (
			error instanceof TypeError &&
			(error as any).cause?.code === "ECONNREFUSED"
		) {
			return new MLProviderUnavailableError(
				"local",
				"Embedding sidecar not running. Start with: bun run dev:embeddings",
			);
		}
		// Generic connection failure
		if (error instanceof TypeError) {
			return new MLProviderUnavailableError(
				"local",
				"Embedding sidecar not running. Start with: bun run dev:embeddings",
			);
		}
		return new MLApiError(
			"local",
			operation,
			error instanceof Error ? error.message : "Unknown HTTP error",
		);
	}

	private mapHttpErrorTag(
		tag: string | undefined,
		message: string,
		operation: string,
	): MLProviderError {
		if (tag === "MLTimeoutError")
			return new MLTimeoutError("local", operation, HTTP_TIMEOUT_MS);
		if (tag === "MLProviderUnavailableError")
			return new MLProviderUnavailableError("local", message);
		return new MLApiError("local", operation, message);
	}

	private mapDirectError(
		error: unknown,
		operation: string,
	): Result<never, MLProviderError> {
		if (error instanceof MLProviderUnavailableError) {
			return Result.err(error);
		}

		if (error instanceof Error) {
			if (
				error.message.includes("timeout") ||
				error.message.includes("timed out")
			) {
				return Result.err(new MLTimeoutError("local", operation, 30000));
			}

			if (error.message.includes("Failed to load")) {
				return Result.err(
					new MLProviderUnavailableError("local", error.message),
				);
			}

			return Result.err(new MLApiError("local", operation, error.message));
		}

		return Result.err(new MLApiError("local", operation, "Unknown error"));
	}
}

/**
 * Creates a local provider instance.
 *
 * @returns Result containing provider or error if not in local mode
 */
export function createLocalProvider(): Result<LocalProvider, MLConfigError> {
	const mlProvider = env.ML_PROVIDER;

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

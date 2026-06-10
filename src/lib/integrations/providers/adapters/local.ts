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
 * - Reranking: Qwen/Qwen3-Reranker-0.6B via the zhiqing ONNX export
 *   (decoder-only LM, yes/no logit scoring at last token position)
 *
 * NOTE: production embeds/reranks via DeepInfra; this in-process path is for
 * local dev. The fp32 Qwen3-Embedding weights are a ~2.4GB first-time download.
 * The reranker ONNX (fp32) is ~1.2GB. Both are cached after first download.
 *
 * Reranker scoring (Qwen3-Reranker, decoder-only LM):
 *   For each (query, document) pair, build the chat-template prompt with the
 *   model's system instruction + user message (<Instruct>/<Query>/<Document>).
 *   Run a forward pass, extract logits at the LAST token position, read the
 *   "yes" and "no" token ids, compute softmax over [no_logit, yes_logit],
 *   take P("yes") as the relevance score in [0, 1].
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
import {
	DEFAULT_RERANK_INSTRUCTION,
	type EmbeddingResult,
	type EmbedOptions,
	type ProviderMetadata,
	type RerankOptions,
	type RerankResult,
} from "../types";

const HTTP_TIMEOUT_MS = 120_000;

// The official Qwen repos ship no ONNX export, so transformers.js loads
// community conversions. Vectors/scores are stored under canonical model names
// (metadata.embeddingModel / metadata.rerankerModel) to share cache keys with
// the DeepInfra path even though the ONNX weights come from a different HF repo.
const EMBEDDING_ONNX_REPO = "onnx-community/Qwen3-Embedding-0.6B-ONNX";
// fp32 matches the hosted model most closely; the ~2.4GB fp32 weights are
// external ONNX data, which transformers.js only fetches when this flag is set.
const EMBEDDING_PIPELINE_OPTIONS = {
	dtype: "fp32",
	use_external_data_format: true,
} as const;

// zhiqing's ONNX export ships model.onnx at the repo root (not under onnx/).
// We override subfolder="" so transformers.js resolves model.onnx correctly.
// dtype "fp32" + suffix "" → model.onnx (the only file in this repo).
// The download is ~1.2 GB (single-file fp32, first run only).
const RERANKER_ONNX_REPO = "zhiqing/Qwen3-Reranker-0.6B-ONNX";
const RERANKER_MODEL_OPTIONS = {
	dtype: "fp32",
	subfolder: "",
} as const;

// System prompt from the Qwen3-Reranker model card — must not be altered.
const RERANKER_SYSTEM_PROMPT =
	'Judge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".';

// Qwen3-Embedding is instruction-tuned (see @/lib/integrations/embedding/format)
// and pools the final token's hidden state — NOT mean pooling (that was E5).
const EMBEDDING_INSTRUCTION_TUNED = true;
const EMBEDDING_POOLING = "last_token" as const;
const EMBEDDING_DIMS = 512;

export class LocalProvider implements MLProvider {
	private readonly metadata: ProviderMetadata;
	private embeddingPipeline: Promise<any> | null = null;
	// Lazy-loaded reranker: model+tokenizer pair, resolved yes/no token ids,
	// and pre-tokenized suffix appended after the user message (forces the
	// last input token to the yes/no decision position).
	private rerankerState: Promise<{
		model: any;
		tokenizer: any;
		yesTokenId: number;
		noTokenId: number;
		suffixIds: number[];
	}> | null = null;
	private mode: "direct" | "http" | "unknown" = "unknown";
	private readonly serverBaseUrl: string;
	private resolveModePromise: Promise<void> | null = null;

	constructor(options?: { forceDirect?: boolean }) {
		this.metadata = {
			name: "local",
			embeddingModel: "Qwen/Qwen3-Embedding-0.6B",
			embeddingDims: EMBEDDING_DIMS,
			embeddingInstructionTuned: EMBEDDING_INSTRUCTION_TUNED,
			// Canonical model id used for cache-key provenance — same as DeepInfra.
			// The actual ONNX weights are loaded from RERANKER_ONNX_REPO.
			rerankerModel: "Qwen/Qwen3-Reranker-0.6B",
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
	 * Lazy-loads the Qwen3-Reranker model + tokenizer (direct mode only).
	 *
	 * Resolves yes/no token ids and pre-tokenizes the suffix tokens once on
	 * load so each rerank call avoids repeated work. Logged for auditability.
	 *
	 * Note: First load downloads ~1.2 GB. Subsequent calls use cached weights.
	 */
	private async getRerankerState(): Promise<{
		model: any;
		tokenizer: any;
		yesTokenId: number;
		noTokenId: number;
		suffixIds: number[];
	}> {
		await this.resolveMode();
		if (this.mode === "http") return null as any;

		if (!this.rerankerState) {
			this.rerankerState = (async () => {
				try {
					const { AutoModelForCausalLM, AutoTokenizer } = await import(
						"@huggingface/transformers"
					);
					console.log(
						`[Local Provider] Loading reranker: ${RERANKER_ONNX_REPO} (~1.2GB fp32, first time only)`,
					);
					const [model, tokenizer] = await Promise.all([
						AutoModelForCausalLM.from_pretrained(
							RERANKER_ONNX_REPO,
							RERANKER_MODEL_OPTIONS,
						),
						AutoTokenizer.from_pretrained(RERANKER_ONNX_REPO),
					]);

					// Resolve yes/no token ids from the tokenizer vocabulary.
					// The model card uses lowercase "yes"/"no"; encode without
					// special tokens and take the first resulting id.
					const yesIds = tokenizer.encode("yes", {
						add_special_tokens: false,
					}) as number[];
					const noIds = tokenizer.encode("no", {
						add_special_tokens: false,
					}) as number[];
					const yesTokenId = yesIds[0];
					const noTokenId = noIds[0];
					console.log(
						`[Local Provider] Reranker yes-token id=${yesTokenId}, no-token id=${noTokenId}`,
					);

					// Pre-tokenize the assistant suffix that the model card appends
					// after the user message. This positions the last token at the
					// yes/no decision point. The suffix is per the Qwen3-Reranker
					// model card and the chat_template.jinja in the ONNX repo:
					//   <|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n
					const suffixStr =
						"<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n";
					const suffixIds = tokenizer.encode(suffixStr, {
						add_special_tokens: false,
					}) as number[];
					console.log(
						`[Local Provider] Reranker suffix tokens (${suffixIds.length}): ${JSON.stringify(suffixIds)}`,
					);

					console.log("[Local Provider] Reranker ready.");
					return { model, tokenizer, yesTokenId, noTokenId, suffixIds };
				} catch (error) {
					this.rerankerState = null;
					throw new Error(
						`Failed to load reranker model: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			})();
		}
		return this.rerankerState;
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
			// Resolve mode first; http path short-circuits before model load.
			await this.resolveMode();

			if (this.mode === "http") {
				return this.rerankViaHttp(query, documents, options);
			}

			const {
				model: lm,
				tokenizer,
				yesTokenId,
				noTokenId,
				suffixIds,
			} = await this.getRerankerState();

			// Canonical fallback so direct provider calls (bypassing RerankerService)
			// still score with the same <Instruct> slot as production.
			const instruction = options?.instruction ?? DEFAULT_RERANK_INSTRUCTION;

			// Score each document sequentially (≤50 docs for a local playlist
			// refresh). Batching would require padding + careful attention-mask
			// handling; sequential is simpler and fast enough for this workload.
			const rawScores: number[] = [];
			for (const doc of documents) {
				// Build the prompt manually using the Qwen3 chatml format.
				// The zhiqing tokenizer_config.json does not include chat_template,
				// so apply_chat_template() fails without passing the template
				// string explicitly. Manual construction is more robust and matches
				// the Qwen3-Reranker model card exactly.
				//
				// Full input structure:
				//   <|im_start|>system\n{system}<|im_end|>\n
				//   <|im_start|>user\n{user}<|im_end|>\n
				//   <|im_start|>assistant\n<think>\n\n</think>\n\n
				//
				// The assistant suffix with the empty <think> block is appended
				// after the user turn (per the model card). This positions the
				// last input token at the yes/no decision point.
				const promptStr =
					`<|im_start|>system\n${RERANKER_SYSTEM_PROMPT}<|im_end|>\n` +
					`<|im_start|>user\n<Instruct>: ${instruction}\n\n<Query>: ${query}\n\n<Document>: ${doc}`;

				// Tokenize the base prompt (system + partial user turn, no <|im_end|>
				// yet — the suffix already includes <|im_end|> at its start).
				const promptIds = tokenizer.encode(promptStr, {
					add_special_tokens: false,
				}) as number[];

				// Concatenate base prompt ids + pre-tokenized suffix ids.
				// suffixIds = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
				const inputIds = [...promptIds, ...suffixIds];

				// Wrap in a 2-D int64 tensor [1, seq_len] as required by the model.
				const { Tensor } = await import("@huggingface/transformers");
				const inputTensor = new Tensor(
					"int64",
					BigInt64Array.from(inputIds.map(BigInt)),
					[1, inputIds.length],
				);
				const attentionMask = new Tensor(
					"int64",
					BigInt64Array.from(new Array(inputIds.length).fill(BigInt(1))),
					[1, inputIds.length],
				);

				// Forward pass. outputs.logits shape: [batch=1, seq_len, vocab_size].
				const outputs = await lm({
					input_ids: inputTensor,
					attention_mask: attentionMask,
				});
				const logits = outputs.logits; // Tensor [1, seq_len, vocab_size]

				// Last-position logits: logits[0][seq_len - 1] → Tensor [vocab_size].
				const seqLen: number = logits.dims[1];
				const lastLogits = logits[0][seqLen - 1]; // Tensor [vocab_size]
				const logitData = lastLogits.data as Float32Array;

				// Softmax over [no_logit, yes_logit] → P("yes").
				const yesLogit = logitData[yesTokenId];
				const noLogit = logitData[noTokenId];
				const maxLogit = Math.max(yesLogit, noLogit);
				const expYes = Math.exp(yesLogit - maxLogit);
				const expNo = Math.exp(noLogit - maxLogit);
				rawScores.push(expYes / (expYes + expNo));
			}

			const scores = rawScores.map((score, index) => ({ index, score }));
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

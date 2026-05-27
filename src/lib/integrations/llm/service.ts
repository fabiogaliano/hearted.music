/**
 * LLM Service - AI SDK integration for structured LLM output.
 *
 * Responsibilities:
 * - Generate text and structured objects via AI SDK
 * - Support multiple providers (Google, Anthropic, OpenAI)
 * - Handle rate limiting and error normalization
 *
 * Uses:
 * - AI SDK for provider abstraction
 * - Zod schemas as single source of truth
 * - Result<T, Error> for composable error handling
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import { Result } from "better-result";
import type { CredentialBody } from "google-auth-library";
import { z } from "zod";
import {
	isRetryableLlmError,
	type LlmError,
	LlmProviderError,
	LlmRateLimitError,
	llmRetryAfterMs,
} from "@/lib/shared/errors/external/llm";
import { ConcurrencyLimiter } from "@/lib/shared/utils/concurrency";
import { withRetry } from "@/lib/shared/utils/result-wrappers/generic";
import { DEFAULT_LLM_PROVIDER, resolveLlmConfig } from "./config";

// ============================================================================
// Zod Schemas (single source of truth)
// ============================================================================

/** Supported LLM provider names */
const LlmProviderNameSchema = z.enum([
	"google",
	"google-vertex",
	"anthropic",
	"openai",
]);
export type LlmProviderName = z.infer<typeof LlmProviderNameSchema>;

/** Providers authenticated with a single API key. */
const ApiKeyProviderSchema = z.enum(["google", "anthropic", "openai"]);

// Vertex bills the GCP project (drawing Cloud credits) and authenticates with
// Application Default Credentials, so project/location replace apiKey.
// Credentials are optional: when omitted, google-auth-library resolves ADC from
// GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`.
const VertexConfigSchema = z.object({
	provider: z.literal("google-vertex"),
	project: z.string().min(1),
	location: z.string().min(1).default("us-central1"),
	credentials: z.custom<CredentialBody>().optional(),
	model: z.string().optional(),
});

const ApiKeyConfigSchema = z.object({
	provider: ApiKeyProviderSchema,
	apiKey: z.string().min(1),
	model: z.string().optional(),
});

/** Configuration for LLM service — keyless Vertex or key-based providers. */
const LlmConfigSchema = z.union([VertexConfigSchema, ApiKeyConfigSchema]);
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

/** Token usage information */
const TokenUsageSchema = z.object({
	prompt: z.number(),
	completion: z.number(),
	total: z.number(),
});
type TokenUsage = z.infer<typeof TokenUsageSchema>;

/** Result of a text generation */
const TextGenerationResultSchema = z.object({
	text: z.string(),
	model: z.string(),
	tokens: TokenUsageSchema.optional(),
});
type TextGenerationResult = z.infer<typeof TextGenerationResultSchema>;

/** Result of an object generation (generic, schema defined at call site) */
interface ObjectGenerationResult<T> {
	output: T;
	model: string;
	tokens?: TokenUsage;
}

// ============================================================================
// Constants
// ============================================================================

/** Default models per provider */
const DEFAULT_MODELS: Record<LlmProviderName, string> = {
	google: "gemini-2.5-flash",
	"google-vertex": "gemini-2.5-flash",
	anthropic: "claude-sonnet-4-20250514",
	openai: "gpt-4o-mini",
};

type LlmServiceError = LlmError;

// Shared across all instances so concurrent worker jobs respect a single rate limit
const sharedLimiter = new ConcurrencyLimiter(3, 100, 500);

// Safety ceiling against runaway output cost (50 songs/job × concurrent calls).
// Deliberately generous: well above any real structured analysis, but a hard
// cap so a degenerate/looping generation can't bill unbounded tokens. Callers
// pass a tighter value when they know their output is small.
const DEFAULT_MAX_OUTPUT_TOKENS = 4000;

const LLM_RETRY_OPTIONS = {
	maxRetries: 2,
	baseDelayMs: 1000,
	maxDelayMs: 30_000,
	isRetryable: isRetryableLlmError,
	getRetryAfterMs: llmRetryAfterMs,
} as const;

// ============================================================================
// Service
// ============================================================================

export class LlmService {
	private readonly provider: LlmProviderName;
	private readonly model: string;
	private readonly limiter = sharedLimiter;
	private readonly languageModel:
		| ReturnType<typeof createGoogleGenerativeAI>
		| ReturnType<typeof createVertex>
		| ReturnType<typeof createAnthropic>
		| ReturnType<typeof createOpenAI>;

	constructor(config: LlmConfig) {
		// Validate config at boundary
		const validated = LlmConfigSchema.parse(config);

		this.provider = validated.provider;
		this.model = validated.model ?? DEFAULT_MODELS[validated.provider];

		// Create the appropriate provider instance
		switch (validated.provider) {
			case "google":
				this.languageModel = createGoogleGenerativeAI({
					apiKey: validated.apiKey,
				});
				break;
			case "google-vertex":
				this.languageModel = createVertex({
					project: validated.project,
					location: validated.location,
					...(validated.credentials
						? { googleAuthOptions: { credentials: validated.credentials } }
						: {}),
				});
				break;
			case "anthropic":
				this.languageModel = createAnthropic({ apiKey: validated.apiKey });
				break;
			case "openai":
				this.languageModel = createOpenAI({ apiKey: validated.apiKey });
				break;
		}
	}

	/**
	 * Gets the current model identifier.
	 */
	getCurrentModel(): string {
		return `${this.provider}:${this.model}`;
	}

	/**
	 * Generates text from a prompt.
	 */
	async generateText(
		prompt: string,
		options?: {
			functionId?: string;
			distinctId?: string;
			maxOutputTokens?: number;
		},
	): Promise<Result<TextGenerationResult, LlmServiceError>> {
		return withRetry(
			() =>
				this.limiter.run(async () => {
					try {
						const result = await generateText({
							model: this.languageModel(this.model),
							prompt,
							maxOutputTokens:
								options?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
							experimental_telemetry: {
								isEnabled: true,
								functionId: options?.functionId ?? "llm-generate-text",
								metadata: options?.distinctId
									? { posthog_distinct_id: options.distinctId }
									: undefined,
							},
						});

						const tokens = this.extractTokenUsage(result.usage);

						return Result.ok({
							text: result.text,
							model: this.getCurrentModel(),
							tokens,
						});
					} catch (error) {
						return Result.err(this.normalizeError(error));
					}
				}),
			LLM_RETRY_OPTIONS,
		);
	}

	/**
	 * Generates a structured object from a prompt using a Zod schema.
	 */
	async generateObject<T>(
		prompt: string,
		schema: z.ZodType<T>,
		options?: {
			functionId?: string;
			distinctId?: string;
			maxOutputTokens?: number;
		},
	): Promise<Result<ObjectGenerationResult<T>, LlmServiceError>> {
		return withRetry(
			() =>
				this.limiter.run(async () => {
					try {
						const result = await generateObject({
							model: this.languageModel(this.model),
							prompt,
							schema,
							maxOutputTokens:
								options?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
							experimental_telemetry: {
								isEnabled: true,
								functionId: options?.functionId ?? "llm-generate-object",
								metadata: options?.distinctId
									? { posthog_distinct_id: options.distinctId }
									: undefined,
							},
						});

						const tokens = this.extractTokenUsage(result.usage);

						return Result.ok({
							output: result.object as T,
							model: this.getCurrentModel(),
							tokens,
						});
					} catch (error) {
						return Result.err(this.normalizeError(error));
					}
				}),
			LLM_RETRY_OPTIONS,
		);
	}

	/**
	 * Extracts token usage from AI SDK response.
	 */
	private extractTokenUsage(
		usage:
			| { inputTokens?: number; outputTokens?: number; totalTokens?: number }
			| undefined,
	): TokenUsage | undefined {
		if (!usage) return undefined;
		const prompt = usage.inputTokens ?? 0;
		const completion = usage.outputTokens ?? 0;
		const total = usage.totalTokens ?? prompt + completion;
		return { prompt, completion, total };
	}

	// ============================================================================
	// Private Helpers
	// ============================================================================

	/**
	 * Normalizes various error types into our tagged error types.
	 */
	private normalizeError(error: unknown): LlmServiceError {
		if (error instanceof Error) {
			const message = error.message;
			const statusCode = this.extractStatusCode(error);

			// Check for rate limiting
			if (statusCode === 429 || message.toLowerCase().includes("rate limit")) {
				const retryAfter = this.extractRetryAfter(error);
				return new LlmRateLimitError({
					provider: this.provider,
					retryAfterMs: retryAfter,
				});
			}

			return new LlmProviderError({
				provider: this.provider,
				model: this.model,
				statusCode,
				message,
			});
		}

		return new LlmProviderError({
			provider: this.provider,
			model: this.model,
			message: String(error),
		});
	}

	/**
	 * Extracts HTTP status code from error if available.
	 */
	private extractStatusCode(error: Error): number | undefined {
		const anyError = error as unknown as Record<string, unknown>;
		if (typeof anyError.statusCode === "number") return anyError.statusCode;
		if (typeof anyError.status === "number") return anyError.status;
		return undefined;
	}

	/**
	 * Extracts retry-after time from rate limit errors.
	 */
	private extractRetryAfter(error: Error): number | undefined {
		const anyError = error as unknown as Record<string, unknown>;

		// Try common patterns for retry-after
		if (typeof anyError.retryAfter === "number")
			return anyError.retryAfter * 1000;
		if (typeof anyError.retryDelay === "number") return anyError.retryDelay;

		// Try extracting from headers
		const headers = anyError.headers as Record<string, string> | undefined;
		if (headers?.["retry-after"]) {
			const seconds = Number.parseInt(headers["retry-after"], 10);
			if (!Number.isNaN(seconds)) return seconds * 1000;
		}

		return undefined;
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates an LLM service from environment variables.
 * Defaults to Vertex AI (GCP-billed) when no provider is specified.
 */
export function createLlmService(
	provider: LlmProviderName = DEFAULT_LLM_PROVIDER,
): LlmService {
	const resolution = resolveLlmConfig(provider);
	if (!resolution.ok) {
		throw new Error(resolution.reason);
	}

	return new LlmService(resolution.config);
}

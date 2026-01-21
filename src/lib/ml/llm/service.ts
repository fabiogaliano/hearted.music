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

import { Result } from "better-result";
import { generateObject, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import {
	LlmProviderError,
	LlmRateLimitError,
	type LlmError,
} from "@/lib/shared/errors/external/llm";

// ============================================================================
// Zod Schemas (single source of truth)
// ============================================================================

/** Supported LLM provider names */
export const LlmProviderNameSchema = z.enum(["google", "anthropic", "openai"]);
export type LlmProviderName = z.infer<typeof LlmProviderNameSchema>;

/** Configuration for LLM service */
export const LlmConfigSchema = z.object({
	provider: LlmProviderNameSchema,
	apiKey: z.string().min(1),
	model: z.string().optional(),
});
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

/** Token usage information */
export const TokenUsageSchema = z.object({
	prompt: z.number(),
	completion: z.number(),
	total: z.number(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/** Result of a text generation */
export const TextGenerationResultSchema = z.object({
	text: z.string(),
	model: z.string(),
	tokens: TokenUsageSchema.optional(),
});
export type TextGenerationResult = z.infer<typeof TextGenerationResultSchema>;

/** Result of an object generation (generic, schema defined at call site) */
export interface ObjectGenerationResult<T> {
	output: T;
	model: string;
	tokens?: TokenUsage;
}

// ============================================================================
// Constants
// ============================================================================

/** Default models per provider */
const DEFAULT_MODELS: Record<LlmProviderName, string> = {
	google: "gemini-2.0-flash",
	anthropic: "claude-sonnet-4-20250514",
	openai: "gpt-4o-mini",
};

type LlmServiceError = LlmError;

// ============================================================================
// Service
// ============================================================================

export class LlmService {
	private readonly provider: LlmProviderName;
	private readonly model: string;
	private readonly languageModel:
		| ReturnType<typeof createGoogleGenerativeAI>
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
	): Promise<Result<TextGenerationResult, LlmServiceError>> {
		try {
			const result = await generateText({
				model: this.languageModel(this.model),
				prompt,
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
	}

	/**
	 * Generates a structured object from a prompt using a Zod schema.
	 */
	async generateObject<T>(
		prompt: string,
		schema: z.ZodType<T>,
	): Promise<Result<ObjectGenerationResult<T>, LlmServiceError>> {
		try {
			const result = await generateObject({
				model: this.languageModel(this.model),
				prompt,
				schema,
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
 * Defaults to Google if no provider specified.
 */
export function createLlmService(
	provider: LlmProviderName = "google",
): LlmService {
	const apiKey = getApiKeyForProvider(provider);
	if (!apiKey) {
		throw new Error(`Missing API key for provider: ${provider}`);
	}

	return new LlmService({ provider, apiKey });
}

/**
 * Gets the API key for a provider from environment variables.
 */
function getApiKeyForProvider(provider: LlmProviderName): string | undefined {
	switch (provider) {
		case "google":
			return (
				process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY
			);
		case "anthropic":
			return process.env.ANTHROPIC_API_KEY;
		case "openai":
			return process.env.OPENAI_API_KEY;
	}
}

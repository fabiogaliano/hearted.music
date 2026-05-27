/**
 * LLM provider error types.
 */

import { TaggedError } from "better-result";

/** LLM provider request failed */
export class LlmProviderError extends TaggedError("LlmProviderError")<{
	provider: string;
	model: string;
	statusCode?: number;
	message: string;
}>() {
	constructor(opts: {
		provider: string;
		model: string;
		statusCode?: number;
		message: string;
	}) {
		super({
			provider: opts.provider,
			model: opts.model,
			statusCode: opts.statusCode,
			message: `LLM ${opts.provider}:${opts.model} failed${opts.statusCode ? ` (${opts.statusCode})` : ""}: ${opts.message}`,
		});
	}
}

/** LLM rate limit exceeded */
export class LlmRateLimitError extends TaggedError("LlmRateLimitError")<{
	provider: string;
	retryAfterMs?: number;
	message: string;
}>() {
	constructor(opts: { provider: string; retryAfterMs?: number }) {
		super({
			provider: opts.provider,
			retryAfterMs: opts.retryAfterMs,
			message: `Rate limited by ${opts.provider}${opts.retryAfterMs ? `, retry after ${opts.retryAfterMs}ms` : ""}`,
		});
	}
}

/** All LLM errors */
export type LlmError = LlmProviderError | LlmRateLimitError;

/**
 * Retryable LLM errors: rate limits and transient upstream failures (429 / 5xx).
 * Deterministic 4xx and unknown shapes are not. Owned here so the retry wrapper
 * and the analysis-stage classifier share one definition.
 */
export function isRetryableLlmError(error: unknown): boolean {
	if (error instanceof LlmRateLimitError) return true;
	if (error instanceof LlmProviderError) {
		const status = error.statusCode;
		if (status === 429) return true;
		if (status !== undefined && status >= 500) return true;
	}
	return false;
}

/** Retry-After floor in ms, when the provider supplied one (rate limits). */
export function llmRetryAfterMs(error: unknown): number | undefined {
	return error instanceof LlmRateLimitError ? error.retryAfterMs : undefined;
}

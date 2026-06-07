/**
 * LLM provider error types.
 */

import { TaggedError } from "better-result";

/** LLM provider request failed */
export class LlmProviderError extends TaggedError("LlmProviderError")<{
	provider: string;
	model: string;
	statusCode?: number;
	/** Upstream's own retryability verdict, when it supplied one. */
	retryable?: boolean;
	message: string;
}>() {
	constructor(opts: {
		provider: string;
		model: string;
		statusCode?: number;
		retryable?: boolean;
		message: string;
	}) {
		super({
			provider: opts.provider,
			model: opts.model,
			statusCode: opts.statusCode,
			retryable: opts.retryable,
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
 * Retryable LLM errors: rate limits, transient upstream failures (429 / 5xx),
 * and structured-output draws that produced no parseable object. Deterministic
 * 4xx and unknown shapes are not. Owned here so the retry wrapper and the
 * analysis-stage classifier share one definition.
 */
export function isRetryableLlmError(error: unknown): boolean {
	if (error instanceof LlmRateLimitError) return true;
	if (error instanceof LlmProviderError) {
		// Honour the upstream's own verdict first: the AI SDK marks connection
		// resets and other status-less transients retryable, which our status-based
		// rules below can't see once we own retrying instead of the SDK.
		if (error.retryable === true) return true;
		const status = error.statusCode;
		if (status === 429) return true;
		if (status !== undefined && status >= 500) return true;
		// generateObject failed to parse/validate the response. This is usually
		// transient — the model occasionally truncates or malforms the JSON on one
		// draw and returns valid output on the next — so retry rather than fail
		// terminally. Matches the AI SDK's NoObjectGeneratedError message, which
		// normalizeError preserves verbatim inside the wrapped message.
		if (/no object generated/i.test(error.message)) return true;
	}
	return false;
}

/** Retry-After floor in ms, when the provider supplied one (rate limits). */
export function llmRetryAfterMs(error: unknown): number | undefined {
	return error instanceof LlmRateLimitError ? error.retryAfterMs : undefined;
}

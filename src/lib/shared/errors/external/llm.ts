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

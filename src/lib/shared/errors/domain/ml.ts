/**
 * ML Domain Errors - Provider-agnostic errors for ML operations.
 *
 * These errors abstract over provider-specific errors (DeepInfra, HuggingFace, etc.)
 * so consumers can handle errors without coupling to provider implementation details.
 *
 * Error Translation:
 * - Provider-specific errors (DeepInfraApiError, HuggingFaceError) are mapped to these
 * - Consumers depend on MLProviderError union, not provider error types
 */

import { TaggedError } from "better-result";

/**
 * Generic ML API error.
 */
export class MLApiError extends TaggedError("MLApiError")<{
	provider: string;
	operation: string;
	message: string;
	statusCode?: number;
}>() {
	constructor(
		provider: string,
		operation: string,
		message: string,
		statusCode?: number,
	) {
		super({
			provider,
			operation,
			message: `${provider} ${operation} failed: ${message}`,
			statusCode,
		});
	}
}

/**
 * Rate limit exceeded error.
 */
export class MLRateLimitError extends TaggedError("MLRateLimitError")<{
	provider: string;
	retryAfterMs?: number;
	message: string;
}>() {
	constructor(provider: string, retryAfterMs?: number) {
		super({
			provider,
			retryAfterMs,
			message: retryAfterMs
				? `${provider} rate limit exceeded, retry after ${retryAfterMs}ms`
				: `${provider} rate limit exceeded`,
		});
	}
}

/**
 * Provider not available error (missing API key, service down, etc.).
 */
export class MLProviderUnavailableError extends TaggedError(
	"MLProviderUnavailableError",
)<{
	provider: string;
	reason: string;
	message: string;
}>() {
	constructor(provider: string, reason: string) {
		super({
			provider,
			reason,
			message: `${provider} is not available: ${reason}`,
		});
	}
}

/**
 * Invalid configuration error (missing required settings, invalid model name, etc.).
 */
export class MLConfigError extends TaggedError("MLConfigError")<{
	provider: string;
	field: string;
	message: string;
}>() {
	constructor(provider: string, field: string, details: string) {
		super({
			provider,
			field,
			message: `${provider} configuration error: ${field} - ${details}`,
		});
	}
}

/**
 * Timeout error.
 */
export class MLTimeoutError extends TaggedError("MLTimeoutError")<{
	provider: string;
	operation: string;
	timeoutMs: number;
	message: string;
}>() {
	constructor(provider: string, operation: string, timeoutMs: number) {
		super({
			provider,
			operation,
			timeoutMs,
			message: `${provider} ${operation} timed out after ${timeoutMs}ms`,
		});
	}
}

/**
 * Unsupported operation error (provider doesn't support reranking, etc.).
 */
export class MLUnsupportedOperationError extends TaggedError(
	"MLUnsupportedOperationError",
)<{
	provider: string;
	operation: string;
	message: string;
}>() {
	constructor(provider: string, operation: string) {
		super({
			provider,
			operation,
			message: `${provider} does not support operation: ${operation}`,
		});
	}
}

/**
 * Union of all ML provider errors.
 */
export type MLProviderError =
	| MLApiError
	| MLRateLimitError
	| MLProviderUnavailableError
	| MLConfigError
	| MLTimeoutError
	| MLUnsupportedOperationError;

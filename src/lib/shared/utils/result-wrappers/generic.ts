/**
 * Generic Result wrappers for async operations.
 */

import { Result } from "better-result";
import { NetworkError } from "@/lib/shared/errors/external/network";

// ============================================================================
// Retry Utilities
// ============================================================================

export interface RetryOptions<E> {
	/** Maximum retry attempts (default: 2) */
	maxRetries?: number;
	/** Base delay in ms for exponential backoff (default: 500) */
	baseDelayMs?: number;
	/** Maximum delay cap in ms (default: 30000) */
	maxDelayMs?: number;
	/** Predicate to determine if error is retryable (default: always true) */
	isRetryable?: (error: E) => boolean;
}

const DEFAULT_RETRY_OPTIONS = {
	maxRetries: 3,
	baseDelayMs: 500,
	maxDelayMs: 30000,
};

/**
 * Wraps an async Result-returning operation with retry logic.
 * Uses exponential backoff between attempts.
 *
 * @example
 * const result = await withRetry(() => fetchData(), {
 *   maxRetries: 3,
 *   isRetryable: (err) => err instanceof NetworkError,
 * });
 */
export async function withRetry<T, E>(
	operation: () => Promise<Result<T, E>>,
	options: RetryOptions<E> = {},
): Promise<Result<T, E>> {
	const {
		maxRetries = DEFAULT_RETRY_OPTIONS.maxRetries,
		baseDelayMs = DEFAULT_RETRY_OPTIONS.baseDelayMs,
		maxDelayMs = DEFAULT_RETRY_OPTIONS.maxDelayMs,
		isRetryable = () => true,
	} = options;

	const totalAttempts = maxRetries + 1;

	for (let attempt = 1; attempt <= totalAttempts; attempt++) {
		const result = await operation();

		if (Result.isOk(result)) {
			return result;
		}

		const isLastAttempt = attempt === totalAttempts;
		if (!isRetryable(result.error) || isLastAttempt) {
			return result;
		}

		const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
		await sleep(delay);
	}

	// TypeScript needs this, but it's unreachable
	throw new Error("Unreachable: retry loop exited without returning");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps any async function in a Result with network error handling.
 *
 * @example
 * const result = await tryNetwork(() => fetch(url));
 */
export async function tryNetwork<T>(
	fn: () => Promise<T>,
): Promise<Result<T, NetworkError>> {
	return Result.tryPromise({
		try: fn,
		catch: (error) => mapNetworkError(error),
	});
}

/**
 * Wraps any async function in a Result with generic error handling.
 *
 * @example
 * const result = await tryAsync(() => fetchExternalData());
 */
export async function tryAsync<T>(
	fn: () => Promise<T>,
): Promise<Result<T, Error>> {
	return Result.tryPromise({
		try: fn,
		catch: (error) =>
			error instanceof Error ? error : new Error(String(error)),
	});
}

function mapNetworkError(error: unknown): NetworkError {
	if (error instanceof TypeError && error.message.includes("fetch")) {
		return new NetworkError("connection");
	}
	if (error instanceof Error && error.name === "AbortError") {
		return new NetworkError("timeout");
	}
	return new NetworkError("unknown");
}

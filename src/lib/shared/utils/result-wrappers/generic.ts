/**
 * Generic Result wrappers for async operations.
 */

import { Result } from "better-result";
import { NetworkError } from "@/lib/shared/errors/external/network";

export interface RetryOptions<E> {
	/** Maximum retry attempts (default: 3) */
	maxRetries?: number;
	/** Base delay in ms for exponential backoff (default: 500) */
	baseDelayMs?: number;
	/** Maximum delay cap in ms (default: 30000) */
	maxDelayMs?: number;
	/** Predicate to determine if error is retryable (default: always true) */
	isRetryable?: (error: E) => boolean;
	/** Retry-after override in ms from the error (e.g. a 429 Retry-After header) */
	getRetryAfterMs?: (error: E) => number | undefined;
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
		getRetryAfterMs,
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

		// A Retry-After longer than our in-request budget is a real back-off, not a
		// blip. Surface the error so the caller's job-level backoff (which honors
		// long windows) takes over, instead of burning an attempt too early.
		const retryAfter = getRetryAfterMs?.(result.error);
		if (retryAfter != null && retryAfter > maxDelayMs) {
			return result;
		}

		// Equal jitter (AWS): keep half the delay, randomize the other half, so
		// concurrent retries de-synchronize instead of hammering in lockstep.
		const exponential = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
		const jittered = exponential / 2 + Math.random() * (exponential / 2);
		const delay =
			retryAfter != null ? Math.max(retryAfter, jittered) : jittered;
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

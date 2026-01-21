/**
 * Result-based Spotify API request helpers.
 *
 * Wraps fetch operations with:
 * - Automatic retry on rate limits (429 + Retry-After)
 * - Error classification into tagged errors
 * - Composable Result types
 */

import { Result } from "better-result";
import {
	SpotifyApiError,
	SpotifyAuthError,
	SpotifyNotFoundError,
	SpotifyRateLimitError,
	type SpotifyError,
} from "@/lib/shared/errors/external/spotify";

/** Options for retry behavior */
export interface RetryOptions {
	/** Maximum number of retry attempts (default: 3) */
	maxRetries?: number;
	/** Base delay in ms between retries (default: 1000) */
	baseDelayMs?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
	maxRetries: 3,
	baseDelayMs: 1000,
};

/**
 * Classifies a raw error/response into a tagged SpotifyError.
 */
export function classifySpotifyError(error: unknown): SpotifyError {
	// Handle response-like objects (from SDK)
	if (typeof error === "object" && error !== null && "status" in error) {
		const status = (error as { status: number }).status;
		const message =
			(error as { message?: string }).message ?? `Spotify API error: ${status}`;

		if (status === 429) {
			const retryAfterMs = extractRetryAfter(error);
			return new SpotifyRateLimitError(retryAfterMs);
		}

		if (status === 401) {
			return new SpotifyAuthError("expired");
		}

		if (status === 403) {
			return new SpotifyAuthError("revoked");
		}

		if (status === 404) {
			return new SpotifyNotFoundError("resource", "unknown");
		}

		return new SpotifyApiError({ status, message });
	}

	// Handle Error instances
	if (error instanceof Error) {
		return new SpotifyApiError({ status: 0, message: error.message });
	}

	// Fallback
	return new SpotifyApiError({ status: 0, message: String(error) });
}

/**
 * Extracts Retry-After header value in milliseconds.
 */
function extractRetryAfter(error: unknown): number {
	if (typeof error === "object" && error !== null && "headers" in error) {
		const headers = (
			error as { headers?: { get?: (key: string) => string | null } }
		).headers;
		const retryAfter = headers?.get?.("Retry-After");
		if (retryAfter) {
			return Number.parseInt(retryAfter, 10) * 1000;
		}
	}
	return 1000; // Default 1 second
}

/**
 * Checks if an error is retryable (rate limit).
 */
function isRetryableError(error: SpotifyError): error is SpotifyRateLimitError {
	return error._tag === "SpotifyRateLimitError";
}

/**
 * Gets the delay in ms before retrying.
 */
function getRetryDelay(
	error: SpotifyError,
	_attempt: number,
	baseDelayMs: number,
): number {
	if (error._tag === "SpotifyRateLimitError") {
		return error.retryAfterMs;
	}
	return baseDelayMs;
}

/**
 * Executes a function with automatic retry on rate limits.
 * Returns a Result instead of throwing.
 *
 * @example
 * ```ts
 * const result = await fetchWithRetry(() => sdk.currentUser.profile());
 * if (Result.isOk(result)) {
 *   console.log(result.value.display_name);
 * }
 * ```
 */
export async function fetchWithRetry<T>(
	fetchFn: () => Promise<T>,
	options: RetryOptions = {},
): Promise<Result<T, SpotifyError>> {
	const { maxRetries, baseDelayMs } = { ...DEFAULT_RETRY_OPTIONS, ...options };
	let attempt = 0;
	let lastError: SpotifyError | undefined;

	while (attempt <= maxRetries) {
		const result = await Result.tryPromise({
			try: fetchFn,
			catch: classifySpotifyError,
		});

		if (Result.isOk(result)) {
			return result;
		}

		lastError = result.error;

		if (isRetryableError(result.error) && attempt < maxRetries) {
			const delay = getRetryDelay(result.error, attempt, baseDelayMs);
			await sleep(delay);
			attempt++;
		} else {
			return result;
		}
	}

	// Should not reach here, but TypeScript needs this
	return Result.err(
		lastError ?? new SpotifyApiError({ status: 0, message: "Unknown error" }),
	);
}

/**
 * Single-shot request without retry.
 * Useful for operations that shouldn't be retried (mutations).
 */
export async function fetchOnce<T>(
	fetchFn: () => Promise<T>,
): Promise<Result<T, SpotifyError>> {
	return Result.tryPromise({
		try: fetchFn,
		catch: classifySpotifyError,
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

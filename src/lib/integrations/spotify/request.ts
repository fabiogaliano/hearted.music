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
import { SpotifyRateLimitHttpError } from "./sdk";

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

/** Enable verbose Spotify error logging (set DEBUG_SPOTIFY_ERRORS=true in env) */
const DEBUG_SPOTIFY_ERRORS = process.env.DEBUG_SPOTIFY_ERRORS === "true";

/**
 * Classifies a raw error/response into a tagged SpotifyError.
 */
export function classifySpotifyError(error: unknown): SpotifyError {
	// Handle our custom rate limit error with actual Retry-After header
	if (error instanceof SpotifyRateLimitHttpError) {
		const retryAfterMs = error.retryAfterSeconds
			? error.retryAfterSeconds * 1000
			: 60000; // Default 60s if no header
		console.warn(`[Spotify] Rate limit with Retry-After: ${error.retryAfterSeconds}s (${retryAfterMs}ms)`);
		return new SpotifyRateLimitError(retryAfterMs);
	}

	// Verbose error logging (enable with DEBUG_SPOTIFY_ERRORS=true for rate limit debugging)
	if (DEBUG_SPOTIFY_ERRORS) {
		console.warn("[Spotify] ========== ERROR DETAILS ==========");

		if (error instanceof Error) {
			console.warn("[Spotify] Type: Error instance");
			console.warn("[Spotify] Name:", error.name);
			console.warn("[Spotify] Message:", error.message);
			console.warn("[Spotify] Stack:", error.stack?.split("\n").slice(0, 3).join("\n"));

			// Try to get all properties including non-enumerable
			const allProps = Object.getOwnPropertyNames(error);
			console.warn("[Spotify] All properties:", allProps);
			for (const prop of allProps) {
				if (!["name", "message", "stack"].includes(prop)) {
					try {
						console.warn(`[Spotify] error.${prop}:`, (error as unknown as Record<string, unknown>)[prop]);
					} catch {
						console.warn(`[Spotify] error.${prop}: <unreadable>`);
					}
				}
			}

			// Check for cause (Error.cause is standard in ES2022)
			if ("cause" in error && error.cause) {
				console.warn("[Spotify] Cause:", error.cause);
			}
		} else if (typeof error === "object" && error !== null) {
			console.warn("[Spotify] Type: Object");
			console.warn("[Spotify] Keys:", Object.keys(error));
			console.warn("[Spotify] Full object:", JSON.stringify(error, null, 2));

			// Check for headers (useful for debugging rate limits)
			if ("headers" in error) {
				const headers = (error as { headers: unknown }).headers;
				console.warn("[Spotify] Headers found:", headers);
				if (headers && typeof headers === "object" && "get" in headers) {
					const h = headers as { get: (k: string) => string | null };
					console.warn("[Spotify] Retry-After header:", h.get("Retry-After"));
					console.warn("[Spotify] X-RateLimit-Limit:", h.get("X-RateLimit-Limit"));
					console.warn("[Spotify] X-RateLimit-Remaining:", h.get("X-RateLimit-Remaining"));
					console.warn("[Spotify] X-RateLimit-Reset:", h.get("X-RateLimit-Reset"));
				}
			}
		} else {
			console.warn("[Spotify] Type:", typeof error);
			console.warn("[Spotify] Value:", error);
		}

		console.warn("[Spotify] ====================================");
	}

	// Handle Error instances with message containing rate limit info
	if (error instanceof Error && (error.message.includes("rate limit") || error.message.includes("exceeded"))) {
		// Development mode rate limits can last 5+ minutes - use 60s to reduce retry spam
		if (DEBUG_SPOTIFY_ERRORS) {
			console.warn("[Spotify] Detected rate limit from Error message, will retry in 60s");
		}
		return new SpotifyRateLimitError(60000);
	}

	// Handle response-like objects (from SDK)
	if (typeof error === "object" && error !== null && "status" in error) {
		const status = (error as { status: number }).status;
		const message =
			(error as { message?: string }).message ?? `Spotify API error: ${status}`;

		if (status === 429) {
			const retryAfterMs = extractRetryAfter(error);
			console.warn(`[Spotify] Rate limited. Retry after: ${retryAfterMs}ms (${Math.ceil(retryAfterMs / 1000)}s)`);
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
			console.warn(`[Spotify] Retry ${attempt + 1}/${maxRetries} after ${Math.ceil(delay / 1000)}s...`);
			await sleep(delay);
			attempt++;
		} else {
			if (attempt >= maxRetries) {
				console.error(`[Spotify] Exhausted all ${maxRetries} retries. Giving up.`);
			}
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

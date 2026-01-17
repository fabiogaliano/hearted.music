/**
 * Generic Result wrappers for async operations.
 */

import { Result } from "better-result";
import { NetworkError } from "@/lib/errors/external";

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

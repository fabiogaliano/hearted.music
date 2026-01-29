/**
 * Result-based pagination helper for Spotify API.
 *
 * Handles paginated endpoints with:
 * - Automatic page fetching with retry
 * - Configurable filtering and early-stop conditions
 * - Composable Result types
 */

import { Result } from "better-result";
import type { MaxInt } from "@fostertheweb/spotify-web-sdk";
import type { SpotifyError } from "@/lib/shared/errors/external/spotify";
import { fetchWithRetry, type RetryOptions } from "./request";

/** Options for paginated fetch */
export interface PaginationOptions<T> {
	/** Function to fetch a page of items */
	fetchPage: (
		limit: MaxInt<50>,
		offset: number,
	) => Promise<{ items: T[]; total?: number }>;
	/** Items per page (max 50 for Spotify) */
	limit: MaxInt<50>;
	/** Optional filter function applied to each item */
	filterFn?: (item: T) => boolean;
	/**
	 * Optional early-stop condition.
	 * Called with original and filtered items from each page.
	 * Return true to stop fetching more pages.
	 */
	shouldStopEarly?: (originalItems: T[], filteredItems: T[]) => boolean;
	/** Retry options for each page fetch */
	retryOptions?: RetryOptions;
	/** Optional callback for progress updates during fetch */
	onProgress?: (fetched: number) => void;
	/** Optional callback for total count once known */
	onTotalDiscovered?: (total: number) => void;
}

/**
 * Fetches all items from a paginated endpoint.
 * Returns a Result containing all collected items or the first error encountered.
 *
 * @example
 * ```ts
 * const result = await fetchAllPages({
 *   fetchPage: (limit, offset) => sdk.currentUser.tracks.savedTracks(limit, offset),
 *   limit: 50,
 *   filterFn: (track) => new Date(track.added_at) > sinceDate,
 *   shouldStopEarly: (original, filtered) => filtered.length < original.length,
 * });
 * ```
 */
export async function fetchAllPages<T>(
	options: PaginationOptions<T>,
): Promise<Result<T[], SpotifyError>> {
	const {
		fetchPage,
		limit,
		filterFn,
		shouldStopEarly,
		retryOptions,
		onProgress,
		onTotalDiscovered,
	} = options;

	return Result.gen(async function* () {
		const allItems: T[] = [];
		let offset = 0;
		let shouldContinue = true;
		let totalDiscovered = false;

		while (shouldContinue) {
			const response = yield* Result.await(
				fetchWithRetry(() => fetchPage(limit, offset), retryOptions),
			);

			const originalItems = response.items;
			const filteredItems = filterFn
				? originalItems.filter(filterFn)
				: originalItems;

			allItems.push(...filteredItems);

			// Notify total count once (first page gives us the total)
			if (
				!totalDiscovered &&
				response.total !== undefined &&
				response.total > 0
			) {
				onTotalDiscovered?.(response.total);
				totalDiscovered = true;
			}

			// Report progress
			onProgress?.(allItems.length);

			// Check early-stop conditions
			if (shouldStopEarly?.(originalItems, filteredItems)) {
				shouldContinue = false;
			} else if (originalItems.length < limit) {
				// No more pages
				shouldContinue = false;
			} else {
				offset += limit;
			}
		}

		return Result.ok(allItems);
	});
}

/**
 * Fetches items from a paginated endpoint in chunks.
 * Yields each page as it's fetched, allowing streaming/progressive updates.
 *
 * @example
 * ```ts
 * for await (const pageResult of fetchPagesIterator({ ... })) {
 *   if (Result.isErr(pageResult)) break;
 *   process(pageResult.value);
 * }
 * ```
 */
export async function* fetchPagesIterator<T>(
	options: Omit<PaginationOptions<T>, "shouldStopEarly">,
): AsyncGenerator<Result<T[], SpotifyError>, void, unknown> {
	const { fetchPage, limit, filterFn, retryOptions } = options;
	let offset = 0;
	let hasMore = true;

	while (hasMore) {
		const result = await fetchWithRetry(
			() => fetchPage(limit, offset),
			retryOptions,
		);

		if (Result.isError(result)) {
			yield Result.err(result.error);
			return;
		}

		const originalItems = result.value.items;
		const filteredItems = filterFn
			? originalItems.filter(filterFn)
			: originalItems;

		yield Result.ok(filteredItems);

		if (originalItems.length < limit) {
			hasMore = false;
		} else {
			offset += limit;
		}
	}
}

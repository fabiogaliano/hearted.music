/**
 * Version constants for cache invalidation.
 *
 * Increment these when algorithms change to invalidate
 * cached embeddings, profiles, and match results.
 */

/** Version of text extraction logic */
export const EXTRACTOR_VERSION = 1;

/** Version of embedding schema/dimensions */
export const EMBEDDING_SCHEMA_VERSION = 1;

/** Version of playlist profile computation */
export const PLAYLIST_PROFILE_VERSION = 1;

/** Version of matching algorithm */
export const MATCHING_ALGO_VERSION = "matching_v2";

/** Combined model bundle version for full invalidation */
export const MODEL_BUNDLE_VERSION = `e${EXTRACTOR_VERSION}_s${EMBEDDING_SCHEMA_VERSION}_p${PLAYLIST_PROFILE_VERSION}_${MATCHING_ALGO_VERSION}`;

// ─────────────────────────────────────────────────────────────────────────────
// Model Bundle Hash (Dynamic)
// ─────────────────────────────────────────────────────────────────────────────

import { Result } from "better-result";
import type { MLProviderError } from "@/lib/shared/errors/domain/ml";
import { getActiveModelBundle } from "./model-bundle";
import { hashModelBundle } from "./hashing";

/** Cached model bundle hash - computed once per process */
let cachedModelBundleHash: string | null = null;

/**
 * Get the current model bundle hash.
 * Cached for the lifetime of the process.
 *
 * Use this instead of MODEL_BUNDLE_VERSION when you need a hash
 * that includes the embedding model configuration.
 *
 * @returns Result with hash string or MLProviderError if model bundle unavailable
 */
export async function getModelBundleHash(): Promise<
	Result<string, MLProviderError>
> {
	if (!cachedModelBundleHash) {
		const bundleResult = getActiveModelBundle();
		if (Result.isError(bundleResult)) {
			return Result.err(bundleResult.error);
		}
		cachedModelBundleHash = await hashModelBundle(bundleResult.value);
	}
	return Result.ok(cachedModelBundleHash);
}

/**
 * Content hashing utilities for cache invalidation.
 *
 * Uses Web Crypto API for Edge-compatible hashing.
 * Prefixes hashes with type and version for traceability.
 */

import type { ModelBundle } from "./model-bundle";
import { MATCHING_ALGO_VERSION, PLAYLIST_PROFILE_VERSION } from "./versioning";

// ============================================================================
// Core Primitives
// ============================================================================

/**
 * Deterministic JSON serialization with sorted keys.
 * Ensures same object always produces same string.
 */
export function stableStringify(obj: unknown): string {
	// Match old behavior: both null and undefined serialize to 'null'
	// This ensures hash compatibility with existing cached values
	if (obj === null || obj === undefined) {
		return "null";
	}

	if (typeof obj !== "object") {
		return JSON.stringify(obj);
	}

	if (Array.isArray(obj)) {
		return `[${obj.map((item) => stableStringify(item)).join(",")}]`;
	}

	const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
	const pairs = sortedKeys.map((key) => {
		const value = (obj as Record<string, unknown>)[key];
		return `${JSON.stringify(key)}:${stableStringify(value)}`;
	});

	return `{${pairs.join(",")}}`;
}

/**
 * Compute SHA-256 hash using Web Crypto API.
 * Returns full 64-character hex string.
 */
async function stableHash(content: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(content);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute short hash (first 16 characters).
 * Sufficient for cache keys with low collision risk.
 */
async function shortHash(content: string): Promise<string> {
	const full = await stableHash(content);
	return full.slice(0, 16);
}

// ============================================================================
// Domain Hash Functions
// ============================================================================

/**
 * Hash playlist profile parameters.
 * Prefix: pp_v{version}_
 */
export async function hashPlaylistProfile(params: {
	playlistId: string;
	songIds: string[];
	descriptionText?: string;
	embeddingCentroid?: number[];
	audioCentroid?: Record<string, number>;
	genreDistribution?: Record<string, number>;
}): Promise<string> {
	const roundedEmbedding = params.embeddingCentroid
		? params.embeddingCentroid.map((value) => Math.round(value * 10000) / 10000)
		: [];

	// Round audio centroid values for float stability
	const roundedCentroid = params.audioCentroid
		? Object.fromEntries(
				Object.entries(params.audioCentroid).map(([k, v]) => [
					k,
					Math.round(v * 10000) / 10000,
				]),
			)
		: {};

	const roundedGenreDistribution = params.genreDistribution
		? Object.fromEntries(
				Object.entries(params.genreDistribution).map(([k, v]) => [
					k,
					Math.round(v * 10000) / 10000,
				]),
			)
		: {};

	const content = stableStringify({
		playlistId: params.playlistId,
		songIds: params.songIds.toSorted(),
		descriptionText: params.descriptionText?.trim() || null,
		embeddingCentroid: roundedEmbedding,
		audioCentroid: roundedCentroid,
		genreDistribution: roundedGenreDistribution,
	});

	const hash = await shortHash(content);
	return `pp_v${PLAYLIST_PROFILE_VERSION}_${hash}`;
}

/**
 * Hash matching configuration.
 * Accepts the full MatchingConfig so every scoring-relevant field
 * participates in the hash automatically.
 * Prefix: mc_{version}_
 */
export async function hashMatchingConfig(
	config: Record<string, unknown>,
): Promise<string> {
	const content = stableStringify(config);
	const hash = await shortHash(content);
	return `mc_${MATCHING_ALGO_VERSION}_${hash}`;
}

/**
 * Hash candidate set (songs being matched).
 * Prefix: cs_
 */
export async function hashCandidateSet(
	songIds: string[],
	contentHashes: string[],
): Promise<string> {
	const content = stableStringify({
		songIds: songIds.toSorted(),
		contentHashes: contentHashes.toSorted(),
	});
	const hash = await shortHash(content);
	return `cs_${hash}`;
}

/**
 * Hash playlist set (target playlists).
 * Prefix: ps_
 */
export async function hashPlaylistSet(
	playlistIds: string[],
	profileHashes: string[],
): Promise<string> {
	const content = stableStringify({
		playlistIds: playlistIds.toSorted(),
		profileHashes: profileHashes.toSorted(),
	});
	const hash = await shortHash(content);
	return `ps_${hash}`;
}

/**
 * Hash exclusion set for match-context deduplication.
 * Prefix: xs_
 */
export async function hashExclusionSet(exclusions: string[]): Promise<string> {
	const content = stableStringify({ exclusions: exclusions.toSorted() });
	const hash = await shortHash(content);
	return `xs_${hash}`;
}

/**
 * Hash reranker model/config for match-context deduplication.
 * Prefix: rc_
 */
export async function hashRerankerConfig(
	config: Record<string, unknown>,
): Promise<string> {
	const content = stableStringify(config);
	const hash = await shortHash(content);
	return `rc_${hash}`;
}

/**
 * Hash full match snapshot for cache lookup.
 * Prefix: snap_
 */
export async function hashMatchSnapshot(params: {
	candidateSetHash: string;
	playlistSetHash: string;
	configHash: string;
	modelBundleHash?: string;
	exclusionSetHash?: string;
	rerankerConfigHash?: string;
}): Promise<string> {
	const content = stableStringify(params);
	const hash = await shortHash(content);
	return `snap_${hash}`;
}

/**
 * Hash model bundle configuration for cache invalidation.
 * Includes embedding model, algorithms, and enrichment config.
 * Prefix: mb_
 *
 * When any component changes (model, algorithm versions, enrichment settings),
 * the hash changes automatically, invalidating all dependent caches.
 */
export async function hashModelBundle(bundle: ModelBundle): Promise<string> {
	// Extract only version-relevant fields for hashing
	const content = stableStringify({
		embedding: {
			model: bundle.embedding.model,
			dims: bundle.embedding.dims,
			provider: bundle.embedding.provider,
			// The instruct format changes the bytes of every query-side vector,
			// so format identity must invalidate caches like a model change does.
			isInstructionTuned: bundle.embedding.isInstructionTuned,
			queryTask: bundle.embedding.queryTask,
		},
		reranker: bundle.reranker
			? {
					model: bundle.reranker.model,
					provider: bundle.reranker.provider,
				}
			: null,
		algorithms: bundle.algorithms,
		enrichment: bundle.enrichment,
		version: bundle.version,
	});

	const hash = await shortHash(content);
	return `mb_${hash}`;
}

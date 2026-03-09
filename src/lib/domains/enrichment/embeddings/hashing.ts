/**
 * Content hashing utilities for cache invalidation.
 *
 * Uses Web Crypto API for Edge-compatible hashing.
 * Prefixes hashes with type and version for traceability.
 */

import type { ModelBundle } from "./model-bundle";
import {
	EXTRACTOR_VERSION,
	MATCHING_ALGO_VERSION,
	PLAYLIST_PROFILE_VERSION,
} from "./versioning";

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
export async function stableHash(content: string): Promise<string> {
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
export async function shortHash(content: string): Promise<string> {
	const full = await stableHash(content);
	return full.slice(0, 16);
}

// ============================================================================
// Domain Hash Functions
// ============================================================================

/**
 * Hash track content for embedding cache.
 * Prefix: te_v{version}_
 */
export async function hashTrackContent(text: string): Promise<string> {
	const hash = await shortHash(text);
	return `te_v${EXTRACTOR_VERSION}_${hash}`;
}

/**
 * Hash playlist profile parameters.
 * Prefix: pp_v{version}_
 */
export async function hashPlaylistProfile(params: {
	playlistId: string;
	songIds: string[];
	audioCentroid?: Record<string, number>;
}): Promise<string> {
	// Round audio centroid values for float stability
	const roundedCentroid = params.audioCentroid
		? Object.fromEntries(
				Object.entries(params.audioCentroid).map(([k, v]) => [
					k,
					Math.round(v * 10000) / 10000,
				]),
			)
		: {};

	const content = stableStringify({
		playlistId: params.playlistId,
		songIds: params.songIds.sort(),
		audioCentroid: roundedCentroid,
	});

	const hash = await shortHash(content);
	return `pp_v${PLAYLIST_PROFILE_VERSION}_${hash}`;
}

/**
 * Hash matching configuration.
 * Prefix: mc_{version}_
 */
export async function hashMatchingConfig(config: {
	weights: Record<string, number>;
	audioWeights: Record<string, number>;
	minScoreThreshold: number;
}): Promise<string> {
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
		songIds: songIds.sort(),
		contentHashes: contentHashes.sort(),
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
		playlistIds: playlistIds.sort(),
		profileHashes: profileHashes.sort(),
	});
	const hash = await shortHash(content);
	return `ps_${hash}`;
}

/**
 * Hash full match context for cache lookup.
 * Prefix: ctx_
 */
export async function hashMatchContext(params: {
	candidateSetHash: string;
	playlistSetHash: string;
	configHash: string;
	modelBundleHash?: string;
}): Promise<string> {
	const content = stableStringify(params);
	const hash = await shortHash(content);
	return `ctx_${hash}`;
}

/**
 * Hash genre lookup parameters.
 * Prefix: tg_
 */
export async function hashTrackGenre(params: {
	artist: string;
	album?: string;
}): Promise<string> {
	const content = stableStringify({
		artist: params.artist.toLowerCase().trim(),
		album: params.album?.toLowerCase().trim() ?? "",
	});
	const hash = await shortHash(content);
	return `tg_${hash}`;
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

// ============================================================================
// Hash Parsing
// ============================================================================

/** Parsed hash components */
export interface ParsedHash {
	type: string;
	version?: string;
	hash: string;
}

/**
 * Parse hash prefix to extract type and version.
 */
export function parseHashPrefix(hash: string): ParsedHash | null {
	const patterns = [
		/^(te)_v(\d+)_(.+)$/, // Track embedding
		/^(pp)_v(\d+)_(.+)$/, // Playlist profile
		/^(mc)_([^_]+)_(.+)$/, // Matching config
		/^(cs)_(.+)$/, // Candidate set (no version)
		/^(ps)_(.+)$/, // Playlist set (no version)
		/^(ctx)_(.+)$/, // Match context (no version)
		/^(tg)_(.+)$/, // Track genre (no version)
		/^(mb)_(.+)$/, // Model bundle (no version - hash IS the version)
	];

	for (const pattern of patterns) {
		const match = hash.match(pattern);
		if (match) {
			if (match.length === 4) {
				return { type: match[1], version: match[2], hash: match[3] };
			}
			return { type: match[1], hash: match[2] };
		}
	}

	return null;
}

/**
 * Check if hash uses current version for its type.
 */
export function isCurrentVersion(hash: string): boolean {
	const parsed = parseHashPrefix(hash);
	if (!parsed) return false;

	switch (parsed.type) {
		case "te":
			return parsed.version === String(EXTRACTOR_VERSION);
		case "pp":
			return parsed.version === String(PLAYLIST_PROFILE_VERSION);
		case "mc":
			return parsed.version === MATCHING_ALGO_VERSION;
		default:
			return true; // Unversioned hashes are always "current"
	}
}

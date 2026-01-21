/**
 * Semantic similarity matcher.
 *
 * Compares strings using embedding cosine similarity.
 * Includes fast paths for exact/substring matches and caching.
 */

import { Result } from "better-result";
import type { EmbeddingService } from "@/lib/ml/embedding/service";
import { SEMANTIC_THRESHOLDS } from "./config";

// ============================================================================
// Types
// ============================================================================

/** Result of similarity search */
export interface SimilarResult {
	readonly value: string;
	readonly similarity: number;
}

/** Cache entry with TTL */
interface CacheEntry {
	readonly embedding: number[];
	readonly expiresAt: number;
}

/** Semantic matcher configuration */
export interface SemanticMatcherConfig {
	/** Similarity threshold for "similar" (default: 0.65) */
	readonly threshold: number;
	/** Cache TTL in milliseconds (default: 1 hour) */
	readonly cacheTtlMs: number;
	/** Maximum cache size (default: 1000) */
	readonly maxCacheSize: number;
}

// ============================================================================
// Service
// ============================================================================

export class SemanticMatcher {
	private readonly cache = new Map<string, CacheEntry>();
	private readonly config: SemanticMatcherConfig;

	constructor(
		private readonly embeddingService: EmbeddingService | null,
		config?: Partial<SemanticMatcherConfig>,
	) {
		this.config = {
			threshold: config?.threshold ?? SEMANTIC_THRESHOLDS.similar,
			cacheTtlMs: config?.cacheTtlMs ?? 60 * 60 * 1000, // 1 hour
			maxCacheSize: config?.maxCacheSize ?? 1000,
		};
	}

	/**
	 * Check if two strings are semantically similar.
	 * Fast paths: exact match, substring containment.
	 */
	async areSimilar(
		str1: string,
		str2: string,
		threshold?: number,
	): Promise<boolean> {
		const t = threshold ?? this.config.threshold;

		// Fast path: exact match
		const norm1 = this.normalize(str1);
		const norm2 = this.normalize(str2);
		if (norm1 === norm2) return true;

		// Fast path: substring containment
		if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

		// Embedding similarity
		const similarity = await this.getSimilarity(str1, str2);
		return similarity >= t;
	}

	/**
	 * Get cosine similarity between two strings.
	 * Returns 0 if embeddings unavailable.
	 */
	async getSimilarity(str1: string, str2: string): Promise<number> {
		// No embedding service = can't compute
		if (!this.embeddingService) return 0;

		const [emb1, emb2] = await Promise.all([
			this.getOrComputeEmbedding(str1),
			this.getOrComputeEmbedding(str2),
		]);

		if (!emb1 || !emb2) return 0;

		return this.cosineSimilarity(emb1, emb2);
	}

	/**
	 * Find strings similar to query from candidates.
	 */
	async findSimilar(
		query: string,
		candidates: string[],
		threshold?: number,
	): Promise<SimilarResult[]> {
		const t = threshold ?? this.config.threshold;
		const results: SimilarResult[] = [];

		for (const candidate of candidates) {
			const similarity = await this.getSimilarity(query, candidate);
			if (similarity >= t) {
				results.push({ value: candidate, similarity });
			}
		}

		return results.sort((a, b) => b.similarity - a.similarity);
	}

	/**
	 * Count semantic matches between two lists.
	 */
	async countMatches(
		list1: string[],
		list2: string[],
		threshold?: number,
	): Promise<number> {
		const t = threshold ?? this.config.threshold;
		let count = 0;

		for (const item1 of list1) {
			for (const item2 of list2) {
				if (await this.areSimilar(item1, item2, t)) {
					count++;
					break; // Count each item1 at most once
				}
			}
		}

		return count;
	}

	/**
	 * Compute full similarity matrix between two lists.
	 */
	async computeSimilarityMatrix(
		list1: string[],
		list2: string[],
	): Promise<number[][]> {
		const matrix: number[][] = [];

		for (const item1 of list1) {
			const row: number[] = [];
			for (const item2 of list2) {
				const similarity = await this.getSimilarity(item1, item2);
				row.push(similarity);
			}
			matrix.push(row);
		}

		return matrix;
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Get embedding from cache or compute.
	 */
	private async getOrComputeEmbedding(text: string): Promise<number[] | null> {
		const key = this.normalize(text);

		// Check cache
		const cached = this.cache.get(key);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.embedding;
		}

		// Compute embedding
		if (!this.embeddingService) return null;

		// Use the embedding service to embed arbitrary text
		// Note: This is a simplified version - in production you'd want
		// the embedding service to expose a method for raw text embedding
		const embedding = await this.embedText(text);
		if (!embedding) return null;

		// Cache with TTL
		this.cacheEmbedding(key, embedding);

		return embedding;
	}

	/**
	 * Embed arbitrary text using EmbeddingService.
	 * Uses "query:" prefix for similarity search optimization.
	 * Falls back to null if service unavailable or on error.
	 */
	private async embedText(text: string): Promise<number[] | null> {
		if (!this.embeddingService) {
			return null;
		}

		const result = await this.embeddingService.embedText(text, {
			prefix: "query:",
		});
		if (Result.isError(result)) {
			return null;
		}
		return result.value;
	}

	/**
	 * Cache an embedding with TTL.
	 */
	private cacheEmbedding(key: string, embedding: number[]): void {
		// Evict oldest if at capacity
		if (this.cache.size >= this.config.maxCacheSize) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey) this.cache.delete(firstKey);
		}

		this.cache.set(key, {
			embedding,
			expiresAt: Date.now() + this.config.cacheTtlMs,
		});
	}

	/**
	 * Normalize string for comparison.
	 */
	private normalize(str: string): string {
		return str.toLowerCase().trim();
	}

	/**
	 * Compute cosine similarity between two vectors.
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length || a.length === 0) return 0;

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		const denominator = Math.sqrt(normA) * Math.sqrt(normB);
		if (denominator === 0) return 0;

		return dotProduct / denominator;
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create SemanticMatcher instance.
 */
export function createSemanticMatcher(
	embeddingService: EmbeddingService | null,
	config?: Partial<SemanticMatcherConfig>,
): SemanticMatcher {
	return new SemanticMatcher(embeddingService, config);
}

// ============================================================================
// Standalone Utilities
// ============================================================================

/**
 * Compute cosine similarity between two vectors.
 * Exported for use in matching service.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const denominator = Math.sqrt(normA) * Math.sqrt(normB);
	if (denominator === 0) return 0;

	return dotProduct / denominator;
}

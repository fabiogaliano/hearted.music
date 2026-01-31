/**
 * Match caching service.
 *
 * Caches match results using content hashing for invalidation.
 * Computes context hash from songs, playlists, and config.
 */

import { Result } from "better-result";
import {
	hashCandidateSet,
	hashMatchContext,
	hashMatchingConfig,
	hashPlaylistSet,
} from "@/lib/ml/embedding/hashing";
import { getModelBundleHash } from "@/lib/ml/embedding/versioning";
import type { DbError } from "@/lib/shared/errors/database";
import type { MLProviderError } from "@/lib/shared/errors/domain/ml";
import { DEFAULT_MATCHING_CONFIG } from "./config";
import type { MatchingService } from "./service";
import type {
	BatchMatchResult,
	MatchingConfig,
	MatchingError,
	MatchingPlaylistProfile,
	MatchingSong,
	MatchResult,
} from "./types";

// ============================================================================
// Types
// ============================================================================

/** Cached match entry */
export interface CachedMatchEntry {
	readonly contextHash: string;
	readonly matches: Map<string, MatchResult[]>;
	readonly computedAt: number;
	readonly expiresAt: number;
}

/** Cache configuration */
export interface MatchCacheConfig {
	/** Cache TTL in milliseconds (default: 1 hour) */
	readonly ttlMs: number;
	/** Maximum cache entries (default: 100) */
	readonly maxEntries: number;
}

/** Cache statistics */
export interface CacheStats {
	readonly hits: number;
	readonly misses: number;
	readonly evictions: number;
	readonly size: number;
}

// ============================================================================
// Service
// ============================================================================

export class MatchCachingService {
	private readonly cache = new Map<string, CachedMatchEntry>();
	private readonly config: MatchCacheConfig;
	private stats = { hits: 0, misses: 0, evictions: 0 };

	constructor(
		private readonly matchingService: MatchingService,
		config?: Partial<MatchCacheConfig>,
	) {
		this.config = {
			ttlMs: config?.ttlMs ?? 60 * 60 * 1000, // 1 hour
			maxEntries: config?.maxEntries ?? 100,
		};
	}

	/**
	 * Get matches from cache or compute.
	 * Uses context hash for cache lookup with database persistence.
	 */
	async getOrComputeMatches(
		accountId: string | null,
		songs: MatchingSong[],
		profiles: MatchingPlaylistProfile[],
		songEmbeddings: Map<string, number[]>,
		matchingConfig: Partial<MatchingConfig>,
	): Promise<Result<BatchMatchResult, MatchingError | DbError>> {
		// Compute all metadata once
		const metadata = await this.computeContextMetadata(
			songs,
			profiles,
			matchingConfig,
		);

		// 1. Check memory cache (fast path)
		const cached = this.cache.get(metadata.contextHash);
		if (cached && cached.expiresAt > Date.now()) {
			this.stats.hits++;
			return Result.ok({
				matches: cached.matches,
				failed: [],
				stats: {
					total: songs.length,
					matched: cached.matches.size,
					cached: cached.matches.size,
					computed: 0,
					failed: 0,
				},
			});
		}

		this.stats.misses++;

		// 2. Check database (only if accountId provided)
		if (accountId !== null) {
			const dbResult = await this.loadFromDatabase(
				metadata.contextHash,
				accountId,
				songs,
				profiles,
				songEmbeddings,
			);

			if (Result.isError(dbResult)) {
				return Result.err(dbResult.error);
			}

			if (dbResult.value) {
				// Database hit - cache in memory and return
				this.cacheResult(metadata.contextHash, dbResult.value);
				return Result.ok({
					matches: dbResult.value,
					failed: [],
					stats: {
						total: songs.length,
						matched: dbResult.value.size,
						cached: dbResult.value.size,
						computed: 0,
						failed: 0,
					},
				});
			}
		}

		// 3. Full miss - compute matches
		const computeResult = await this.matchingService.matchBatch(
			songs,
			profiles,
			songEmbeddings,
		);

		if (Result.isError(computeResult)) {
			return computeResult;
		}

		// 4. Persist to database (only if accountId provided)
		if (accountId !== null) {
			const persistResult = await this.persistToDatabase(
				accountId,
				metadata,
				songs,
				profiles,
				computeResult.value.matches,
			);

			// Log persistence errors but don't fail the request
			if (Result.isError(persistResult)) {
				console.error("Failed to persist matches:", persistResult.error);
			}
		}

		// 5. Cache in memory
		this.cacheResult(metadata.contextHash, computeResult.value.matches);

		return computeResult;
	}

	/**
	 * Invalidate cache entries for specific playlists.
	 */
	invalidateForPlaylists(playlistIds: string[]): void {
		const playlistSet = new Set(playlistIds);

		for (const [hash, entry] of this.cache) {
			// Check if any matches involve these playlists
			for (const matches of entry.matches.values()) {
				if (matches.some((m) => playlistSet.has(m.playlistId))) {
					this.cache.delete(hash);
					this.stats.evictions++;
					break;
				}
			}
		}
	}

	/**
	 * Invalidate all cache entries.
	 */
	invalidateAll(): void {
		this.stats.evictions += this.cache.size;
		this.cache.clear();
	}

	/**
	 * Get cache statistics.
	 */
	getStats(): CacheStats {
		return {
			...this.stats,
			size: this.cache.size,
		};
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Load matches from database if context hash exists.
	 * Returns null if not found or incomplete.
	 */
	private async loadFromDatabase(
		contextHash: string,
		accountId: string,
		songs: MatchingSong[],
		_profiles: MatchingPlaylistProfile[],
		songEmbeddings: Map<string, number[]>,
	): Promise<Result<Map<string, MatchResult[]> | null, DbError>> {
		// Import at method level to avoid circular dependencies
		const matchingData = await import("@/lib/data/matching");

		// Find existing context
		const contextResult = await matchingData.getMatchContextByHash(
			contextHash,
			accountId,
		);

		if (Result.isError(contextResult)) {
			return Result.err(contextResult.error);
		}

		if (!contextResult.value) {
			return Result.ok(null); // Cache miss
		}

		const context = contextResult.value;
		const songIds = songs.map((s) => s.id);

		// Load only results for requested songs
		const resultsResult = await matchingData.getMatchResultsForSongs(
			context.id,
			songIds,
		);

		if (Result.isError(resultsResult)) {
			return Result.err(resultsResult.error);
		}

		// Guard against partial cache hits
		if (resultsResult.value.size !== songIds.length) {
			// Incomplete cache, treat as miss
			return Result.ok(null);
		}

		// Compute data availability for confidence (same as MatchingService)
		const matchesMap = new Map<string, MatchResult[]>();
		for (const [songId, dbResults] of resultsResult.value) {
			const song = songs.find((s) => s.id === songId)!;
			const songEmbedding = songEmbeddings.get(songId);

			const availability = {
				hasEmbedding: !!songEmbedding,
				hasGenres: song.genres !== null && song.genres.length > 0,
				hasAudioFeatures: !!song.audioFeatures,
				hasAnalysis: !!song.analysis,
			};

			const availableCount = Object.values(availability).filter(Boolean).length;
			const confidence = availableCount / 5; // 5 total factors checked

			matchesMap.set(
				songId,
				dbResults.map((r) => ({
					songId: r.song_id,
					playlistId: r.playlist_id,
					score: r.score,
					rank: r.rank ?? 0,
					factors: r.factors as any,
					confidence,
					fromCache: true,
				})),
			);
		}

		return Result.ok(matchesMap);
	}

	/**
	 * Persist matches to database.
	 * Handles race conditions by re-fetching context if unique constraint fails.
	 */
	private async persistToDatabase(
		accountId: string,
		metadata: Awaited<ReturnType<typeof this.computeContextMetadata>>,
		songs: MatchingSong[],
		profiles: MatchingPlaylistProfile[],
		matches: Map<string, MatchResult[]>,
	): Promise<Result<string, DbError | MatchingError | MLProviderError>> {
		// Import at method level to avoid circular dependencies
		const matchingData = await import("@/lib/data/matching");
		const { MATCHING_ALGO_VERSION } = await import(
			"@/lib/ml/embedding/versioning"
		);
		const { getActiveModelBundle } = await import(
			"@/lib/ml/embedding/model-bundle"
		);

		// Get active model bundle for embedding model
		const modelBundleResult = getActiveModelBundle();
		if (Result.isError(modelBundleResult)) {
			return Result.err(modelBundleResult.error);
		}
		const modelBundle = modelBundleResult.value;

		// Create match context
		const contextData = {
			account_id: accountId,
			algorithm_version: MATCHING_ALGO_VERSION,
			embedding_model: modelBundle.embedding.model,
			embedding_version: metadata.modelBundleHash,
			analysis_model: null, // Not yet wired
			analysis_version: null,
			weights: metadata.effectiveConfig.weights as any,
			config_hash: metadata.configHash,
			playlist_set_hash: metadata.playlistSetHash,
			candidate_set_hash: metadata.candidateSetHash,
			context_hash: metadata.contextHash,
			playlist_count: profiles.length,
			song_count: songs.length,
		};

		const contextResult = await matchingData.createMatchContext(contextData);

		let contextId: string;

		if (Result.isError(contextResult)) {
			// Handle unique constraint violation (race condition)
			if (contextResult.error._tag === "ConstraintError") {
				// Context exists, re-fetch it to get contextId
				const existingResult = await matchingData.getMatchContextByHash(
					metadata.contextHash,
					accountId,
				);

				if (Result.isError(existingResult) || !existingResult.value) {
					return Result.err(contextResult.error); // Fallback to original error
				}

				contextId = existingResult.value.id;
			} else {
				return Result.err(contextResult.error);
			}
		} else {
			contextId = contextResult.value.id;
		}

		// Flatten matches to insert format
		const insertResults: Array<{
			context_id: string;
			song_id: string;
			playlist_id: string;
			score: number;
			rank: number;
			factors: any;
		}> = [];
		for (const results of matches.values()) {
			for (const result of results) {
				insertResults.push({
					context_id: contextId,
					song_id: result.songId,
					playlist_id: result.playlistId,
					score: result.score,
					rank: result.rank,
					factors: result.factors as any,
				});
			}
		}

		if (insertResults.length > 0) {
			const insertResult = await matchingData.insertMatchResults(insertResults);
			if (Result.isError(insertResult)) {
				// Ignore unique constraint on results (idempotent)
				if (insertResult.error._tag !== "ConstraintError") {
					return Result.err(insertResult.error);
				}
			}
		}

		return Result.ok(contextId);
	}

	/**
	 * Compute context metadata including all hashes and effective config.
	 * Returns all metadata in one pass to avoid redundant computation.
	 */
	private async computeContextMetadata(
		songs: MatchingSong[],
		profiles: MatchingPlaylistProfile[],
		matchingConfig: Partial<MatchingConfig>,
	): Promise<{
		contextHash: string;
		candidateSetHash: string;
		playlistSetHash: string;
		configHash: string;
		modelBundleHash: string;
		effectiveConfig: MatchingConfig;
	}> {
		// Merge with DEFAULT_MATCHING_CONFIG (not cache config)
		const effectiveConfig = { ...DEFAULT_MATCHING_CONFIG, ...matchingConfig };

		// Hash candidate set (songs)
		const songIds = songs.map((s) => s.id);
		const songContentHashes = songs.map((s) =>
			[s.name, s.artists.join(","), s.genres?.join(",") ?? ""].join("|"),
		);
		const candidateSetHash = await hashCandidateSet(songIds, songContentHashes);

		// Hash playlist set
		const playlistIds = profiles.map((p) => p.playlistId);
		const profileHashes = profiles.map((p) =>
			[
				p.playlistId,
				Object.keys(p.genreDistribution).join(","),
				Object.keys(p.audioCentroid).join(","),
			].join("|"),
		);
		const playlistSetHash = await hashPlaylistSet(playlistIds, profileHashes);

		// Hash only matching-relevant config fields
		const configHash = await hashMatchingConfig({
			weights: { ...effectiveConfig.weights } as any,
			audioWeights: { ...effectiveConfig.audioWeights } as any,
			minScoreThreshold: effectiveConfig.minScoreThreshold,
		});

		// Get model bundle hash for cache invalidation
		const modelBundleHashResult = await getModelBundleHash();
		if (Result.isError(modelBundleHashResult)) {
			throw modelBundleHashResult.error;
		}

		// Combine into context hash (includes model version for automatic invalidation)
		const contextHash = await hashMatchContext({
			candidateSetHash,
			playlistSetHash,
			configHash,
			modelBundleHash: modelBundleHashResult.value,
		});

		return {
			contextHash,
			candidateSetHash,
			playlistSetHash,
			configHash,
			modelBundleHash: modelBundleHashResult.value,
			effectiveConfig,
		};
	}

	/**
	 * Cache match results.
	 */
	private cacheResult(
		contextHash: string,
		matches: Map<string, MatchResult[]>,
	): void {
		// Evict oldest if at capacity
		if (this.cache.size >= this.config.maxEntries) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey) {
				this.cache.delete(firstKey);
				this.stats.evictions++;
			}
		}

		this.cache.set(contextHash, {
			contextHash,
			matches,
			computedAt: Date.now(),
			expiresAt: Date.now() + this.config.ttlMs,
		});
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create MatchCachingService instance.
 */
export function createMatchCachingService(
	matchingService: MatchingService,
	config?: Partial<MatchCacheConfig>,
): MatchCachingService {
	return new MatchCachingService(matchingService, config);
}

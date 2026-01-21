/**
 * Genre enrichment service.
 *
 * Orchestrates Last.fm lookups and persists genres to song.genres column.
 * Supports graceful degradation when Last.fm API is unavailable.
 */

import { Result } from "better-result";
import * as songData from "@/lib/data/song";
import type { DbError } from "@/lib/shared/errors/database";
import type { LastFmError } from "@/lib/shared/errors/external/lastfm";
import {
	createLastFmService,
	type LastFmService,
} from "@/lib/integrations/lastfm/service";
import type { GenreSourceLevel } from "@/lib/integrations/lastfm/types";

// ============================================================================
// Types
// ============================================================================

/** Input for genre enrichment */
export interface GenreEnrichmentInput {
	songId: string;
	artist: string;
	trackName: string;
	album?: string;
}

/** Result of genre enrichment for a single track */
export interface GenreEnrichmentResult {
	songId: string;
	genres: string[];
	sourceLevel: GenreSourceLevel;
	fromCache: boolean;
}

/** Progress callback for batch operations */
export interface GenreBatchProgress {
	total: number;
	completed: number;
	cached: number;
	fetched: number;
	notFound: number;
	errors: number;
}

export type GenreBatchProgressCallback = (progress: GenreBatchProgress) => void;

/** Result of batch enrichment */
export interface GenreBatchResult {
	results: Map<string, GenreEnrichmentResult>;
	notFound: Set<string>;
	errors: Map<string, string>;
	stats: {
		total: number;
		cached: number;
		fetched: number;
		notFound: number;
		failed: number;
	};
}

/** All genre service errors */
export type GenreError = LastFmError | DbError;

// ============================================================================
// Service
// ============================================================================

export class GenreEnrichmentService {
	private readonly lastFmService: LastFmService | null;

	constructor(lastFmService: LastFmService | null) {
		this.lastFmService = lastFmService;
	}

	/**
	 * Enrich a single song with genres.
	 * Returns cached result if song already has genres.
	 */
	async enrichSong(
		input: GenreEnrichmentInput,
		options: { skipCache?: boolean; skipPersist?: boolean } = {},
	): Promise<Result<GenreEnrichmentResult | null, GenreError>> {
		const { songId, artist, trackName, album } = input;

		// Check cache (existing genres on song)
		if (!options.skipCache) {
			const songResult = await songData.getById(songId);
			if (Result.isError(songResult)) {
				return Result.err(songResult.error);
			}

			const song = songResult.value;
			if (song?.genres && song.genres.length > 0) {
				return Result.ok({
					songId,
					genres: song.genres,
					sourceLevel: "album" as const, // Assume album level for cached
					fromCache: true,
				});
			}
		}

		// No LastFm service - can't enrich
		if (!this.lastFmService) {
			return Result.ok(null);
		}

		// Fetch from Last.fm
		const lookupResult = await this.lastFmService.getTagsWithFallback(
			artist,
			trackName,
			album,
		);

		if (Result.isError(lookupResult)) {
			return Result.err(lookupResult.error);
		}

		const lookup = lookupResult.value;
		if (!lookup) {
			return Result.ok(null); // Not found on Last.fm
		}

		// Persist to song.genres
		if (!options.skipPersist) {
			const updateResult = await songData.updateGenres(songId, lookup.tags);
			if (Result.isError(updateResult)) {
				return Result.err(updateResult.error);
			}
		}

		return Result.ok({
			songId,
			genres: lookup.tags,
			sourceLevel: lookup.sourceLevel,
			fromCache: false,
		});
	}

	/**
	 * Enrich multiple songs with genres.
	 * Checks cache first, then fetches missing from Last.fm.
	 */
	async enrichBatch(
		inputs: GenreEnrichmentInput[],
		options: { skipCache?: boolean; skipPersist?: boolean } = {},
		onProgress?: GenreBatchProgressCallback,
	): Promise<Result<GenreBatchResult, GenreError>> {
		const results = new Map<string, GenreEnrichmentResult>();
		const notFound = new Set<string>();
		const errors = new Map<string, string>();
		let cached = 0;
		let fetched = 0;

		const progress: GenreBatchProgress = {
			total: inputs.length,
			completed: 0,
			cached: 0,
			fetched: 0,
			notFound: 0,
			errors: 0,
		};

		// First pass: check cache for all songs
		const songIds = inputs.map((i) => i.songId);
		const songsResult = await songData.getByIds(songIds);

		if (Result.isError(songsResult)) {
			return Result.err(songsResult.error);
		}

		const songsById = new Map(songsResult.value.map((s) => [s.id, s]));

		// Separate cached vs needs-fetch
		const needsFetch: GenreEnrichmentInput[] = [];

		for (const input of inputs) {
			const song = songsById.get(input.songId);

			if (!options.skipCache && song?.genres && song.genres.length > 0) {
				// Cache hit
				results.set(input.songId, {
					songId: input.songId,
					genres: song.genres,
					sourceLevel: "album",
					fromCache: true,
				});
				cached++;
				progress.cached++;
				progress.completed++;
			} else {
				needsFetch.push(input);
			}
		}

		onProgress?.(progress);

		// Second pass: fetch from API for cache misses
		if (this.lastFmService && needsFetch.length > 0) {
			const lastFm = this.lastFmService; // Capture for closure
			const batchSize = 10;
			const updates: Array<{ songId: string; genres: string[] }> = [];

			for (let i = 0; i < needsFetch.length; i += batchSize) {
				const batch = needsFetch.slice(i, i + batchSize);

				// Fetch in parallel within batch
				const batchPromises = batch.map(async (input) => {
					const result = await lastFm.getTagsWithFallback(
						input.artist,
						input.trackName,
						input.album,
					);
					return { input, result };
				});

				const batchResults = await Promise.all(batchPromises);

				for (const { input, result } of batchResults) {
					if (Result.isError(result)) {
						errors.set(input.songId, result.error.message);
						progress.errors++;
					} else if (result.value) {
						results.set(input.songId, {
							songId: input.songId,
							genres: result.value.tags,
							sourceLevel: result.value.sourceLevel,
							fromCache: false,
						});
						updates.push({ songId: input.songId, genres: result.value.tags });
						fetched++;
						progress.fetched++;
					} else {
						notFound.add(input.songId);
						progress.notFound++;
					}
					progress.completed++;
				}

				onProgress?.(progress);
			}

			// Batch persist
			if (!options.skipPersist && updates.length > 0) {
				const updateResult = await songData.updateGenresBatch(updates);
				if (Result.isError(updateResult)) {
					// Genres were fetched successfully, just persistence failed
					// Continue without failing the whole batch
				}
			}
		} else {
			// No Last.fm service - mark all unfetched as not found
			for (const input of needsFetch) {
				notFound.add(input.songId);
				progress.notFound++;
				progress.completed++;
			}
			onProgress?.(progress);
		}

		return Result.ok({
			results,
			notFound,
			errors,
			stats: {
				total: inputs.length,
				cached,
				fetched,
				notFound: notFound.size,
				failed: errors.size,
			},
		});
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a GenreEnrichmentService.
 * Works without Last.fm API key (returns cached genres only).
 */
export function createGenreEnrichmentService(): GenreEnrichmentService {
	const lastFmResult = createLastFmService();
	const lastFmService =
		lastFmResult && Result.isOk(lastFmResult) ? lastFmResult.value : null;

	return new GenreEnrichmentService(lastFmService);
}

/**
 * Playlist matching service.
 *
 * Matches songs to playlists using multi-factor scoring:
 * - Vector similarity (embeddings)
 * - Genre overlap
 * - Audio feature similarity
 * - Semantic/thematic alignment
 * - Context compatibility
 * - Flow compatibility
 *
 * Implements the full scoring algorithm from the old MatchingService,
 * adapted to use Result-based error handling and modern patterns.
 */

import { Result } from "better-result";
import type { PlaylistProfilingService } from "@/lib/capabilities/profiling/service";
import type { JobProgress } from "@/lib/data/jobs";
import { emitItem, emitProgress } from "@/lib/jobs/progress/helpers";
import type { EmbeddingService } from "@/lib/ml/embedding/service";
import {
	computeAdaptiveWeights,
	type DataAvailability,
	DEFAULT_MATCHING_CONFIG,
} from "./config";
import {
	computeAudioFeatureScore,
	computeContextScore,
	computeFlowScore,
	computeThematicScore,
} from "./scoring";
import { cosineSimilarity } from "./semantic";
import type {
	BatchMatchResult,
	MatchingConfig,
	MatchingError,
	MatchingPlaylistProfile,
	MatchingSong,
	MatchingWeights,
	MatchResult,
	ScoreFactors,
} from "./types";

/** Options for batch matching with SSE support */
export interface BatchMatchOptions {
	/** Job ID for SSE progress events (optional) */
	jobId?: string;
	/** Progress callback (optional) */
	onProgress?: (progress: JobProgress) => void;
}

// ============================================================================
// Service
// ============================================================================

export class MatchingService {
	private readonly config: MatchingConfig;

	constructor(
		_embeddingService: EmbeddingService | null,
		_profilingService: PlaylistProfilingService | null,
		config?: Partial<MatchingConfig>,
	) {
		this.config = {
			...DEFAULT_MATCHING_CONFIG,
			...config,
		};
	}

	/**
	 * Match a single song to multiple playlists.
	 * Returns ranked results sorted by score descending.
	 */
	async matchSong(
		song: MatchingSong,
		profiles: MatchingPlaylistProfile[],
		songEmbedding?: number[] | null,
	): Promise<Result<MatchResult[], MatchingError>> {
		if (profiles.length === 0) {
			return Result.ok([]);
		}

		const results: MatchResult[] = [];

		for (const profile of profiles) {
			const scoreResult = await this.scoreSongToPlaylist(
				song,
				profile,
				songEmbedding ?? null,
			);

			if (Result.isOk(scoreResult)) {
				results.push(scoreResult.value);
			}
			// Skip failed matches (graceful degradation)
		}

		// Sort by score descending
		results.sort((a, b) => b.score - a.score);

		// Assign ranks and filter by threshold
		const ranked = results
			.filter((r) => r.score >= this.config.minScoreThreshold)
			.slice(0, this.config.maxResultsPerSong)
			.map((r, i) => ({ ...r, rank: i + 1 }));

		return Result.ok(ranked);
	}

	/**
	 * Match multiple songs to multiple playlists.
	 * Returns matches keyed by song ID.
	 *
	 * @param songs - Songs to match
	 * @param profiles - Playlist profiles to match against
	 * @param songEmbeddings - Optional pre-computed embeddings
	 * @param options - Optional SSE options with jobId for progress events
	 */
	async matchBatch(
		songs: MatchingSong[],
		profiles: MatchingPlaylistProfile[],
		songEmbeddings?: Map<string, number[]>,
		options?: BatchMatchOptions,
	): Promise<Result<BatchMatchResult, MatchingError>> {
		if (songs.length === 0 || profiles.length === 0) {
			return Result.ok({
				matches: new Map(),
				failed: [],
				stats: { total: 0, matched: 0, cached: 0, computed: 0, failed: 0 },
			});
		}

		const { jobId, onProgress } = options ?? {};
		const matches = new Map<string, MatchResult[]>();
		const failed: string[] = [];
		let computed = 0;

		// Initialize progress tracking
		const progress: JobProgress = {
			total: songs.length,
			done: 0,
			succeeded: 0,
			failed: 0,
		};

		for (let i = 0; i < songs.length; i++) {
			const song = songs[i];
			const songLabel = song.name
				? `${song.name}`
				: `Song ${song.id.slice(0, 8)}`;

			// Emit: song matching in progress
			if (jobId) {
				emitItem(jobId, {
					itemId: song.id,
					itemKind: "match",
					status: "in_progress",
					label: songLabel,
					index: i,
				});
			}

			const embedding = songEmbeddings?.get(song.id) ?? null;
			const result = await this.matchSong(song, profiles, embedding);

			if (Result.isOk(result) && result.value.length > 0) {
				matches.set(song.id, result.value);
				computed++;
				progress.succeeded++;

				// Emit: song matched successfully
				if (jobId) {
					const bestMatch = result.value[0];
					emitItem(jobId, {
						itemId: song.id,
						itemKind: "match",
						status: "succeeded",
						label: `${songLabel} → score ${bestMatch.score.toFixed(2)}`,
						index: i,
					});
				}
			} else {
				failed.push(song.id);
				progress.failed++;

				// Emit: song match failed
				if (jobId) {
					emitItem(jobId, {
						itemId: song.id,
						itemKind: "match",
						status: "failed",
						label: `${songLabel} (no match)`,
						index: i,
					});
				}
			}

			progress.done++;

			// Emit progress updates periodically (every 10 songs or at end)
			if (
				jobId &&
				(progress.done % 10 === 0 || progress.done === songs.length)
			) {
				emitProgress(jobId, progress);
			}
			onProgress?.(progress);
		}

		return Result.ok({
			matches,
			failed,
			stats: {
				total: songs.length,
				matched: matches.size,
				cached: 0, // No caching in this version
				computed,
				failed: failed.length,
			},
		});
	}

	// ============================================================================
	// Private - Scoring
	// ============================================================================

	/**
	 * Score a song against a playlist profile.
	 * Implements tiered scoring with deep analysis gate.
	 */
	private async scoreSongToPlaylist(
		song: MatchingSong,
		profile: MatchingPlaylistProfile,
		songEmbedding: number[] | null,
	): Promise<Result<MatchResult, MatchingError>> {
		// Determine data availability for adaptive weights
		const availability: DataAvailability = {
			hasEmbedding: !!songEmbedding && !!profile.embedding,
			hasGenres: !!song.genres && song.genres.length > 0,
			hasAudioFeatures:
				!!song.audioFeatures && Object.keys(profile.audioCentroid).length > 0,
			hasAnalysis: !!song.analysis,
			hasRecentSongs: !!profile.recentSongs && profile.recentSongs.length > 0,
		};

		// Compute adaptive weights based on available data
		const weights = computeAdaptiveWeights(availability);

		// ========================================
		// Tier 1: Early scoring (always computed)
		// ========================================

		const vectorScore = this.computeVectorScore(
			songEmbedding,
			profile.embedding,
		);
		const genreScore = this.computeGenreScore(
			song.genres,
			profile.genreDistribution,
		);
		const audioScore = availability.hasAudioFeatures
			? computeAudioFeatureScore(
					song.audioFeatures!,
					profile.audioCentroid,
					this.config.audioWeights,
				)
			: 0;

		// Calculate weighted early score for deep analysis gate
		const earlyScore =
			weights.vector * vectorScore +
			weights.genre * genreScore +
			weights.audio * audioScore;

		// ========================================
		// Tier 2: Deep analysis (if gate passes)
		// ========================================

		let semanticScore = 0;
		let contextScore = 0;
		let flowScore = 0;

		// Only run expensive deep analysis if early score is promising
		if (
			availability.hasAnalysis &&
			earlyScore > this.config.deepAnalysisThreshold
		) {
			// Thematic alignment
			if (song.analysis?.themes && profile.themes) {
				semanticScore = computeThematicScore(
					song.analysis.themes,
					profile.themes,
				);
			}

			// Context alignment
			if (song.analysis?.listeningContexts && profile.listeningContexts) {
				contextScore = computeContextScore(
					song.analysis.listeningContexts,
					profile.listeningContexts,
				);
			}

			// Flow compatibility
			if (availability.hasRecentSongs && profile.recentSongs) {
				const energy = song.audioFeatures?.energy ?? null;
				const valence = song.audioFeatures?.valence ?? null;
				flowScore = computeFlowScore(
					song.analysis?.dominantMood ?? null,
					energy,
					valence,
					profile.recentSongs,
				);
			}
		}

		// ========================================
		// Final Score Calculation
		// ========================================

		const factors: ScoreFactors = {
			vector: vectorScore,
			genre: genreScore,
			audio: audioScore,
			semantic: semanticScore,
			context: contextScore,
			flow: flowScore,
		};

		const finalScore = this.computeFinalScore(factors, weights);

		// Compute confidence based on data availability
		const availableCount = Object.values(availability).filter(Boolean).length;
		const confidence = availableCount / 5; // 5 total factors

		const result: MatchResult = {
			songId: song.id,
			playlistId: profile.playlistId,
			score: Math.max(0, Math.min(1, finalScore)),
			rank: 0, // Will be set after sorting
			factors,
			confidence,
			fromCache: false,
		};

		return Result.ok(result);
	}

	/**
	 * Compute final weighted score from factors.
	 */
	private computeFinalScore(
		factors: ScoreFactors,
		weights: MatchingWeights,
	): number {
		return (
			factors.vector * weights.vector +
			factors.genre * weights.genre +
			factors.audio * weights.audio +
			factors.semantic * weights.semantic +
			factors.context * weights.context +
			factors.flow * weights.flow
		);
	}

	/**
	 * Compute vector similarity score.
	 */
	private computeVectorScore(
		songEmbedding: number[] | null,
		playlistEmbedding: number[] | null,
	): number {
		if (!songEmbedding || !playlistEmbedding) return 0;
		if (this.config.skipVectorScoring) return 0;

		// Cosine similarity is already -1 to 1, normalize to 0-1
		const similarity = cosineSimilarity(songEmbedding, playlistEmbedding);

		// Transform from [-1, 1] to [0, 1]
		return Math.max(0, Math.min(1, (similarity + 1) / 2));
	}

	/**
	 * Compute genre overlap score.
	 */
	private computeGenreScore(
		songGenres: string[] | null,
		playlistDistribution: Record<string, number>,
	): number {
		if (!songGenres || songGenres.length === 0) return 0;

		const playlistGenres = Object.keys(playlistDistribution);
		if (playlistGenres.length === 0) return 0;

		// Normalize song genres for comparison
		const normalizedSongGenres = songGenres.map((g) => g.toLowerCase().trim());

		// Calculate overlap with weighting by playlist distribution
		let weightedMatch = 0;
		let totalWeight = 0;

		for (const [genre, count] of Object.entries(playlistDistribution)) {
			totalWeight += count;
			const normalizedGenre = genre.toLowerCase().trim();

			// Check for exact match or partial match
			const hasMatch = normalizedSongGenres.some(
				(sg) =>
					sg === normalizedGenre ||
					sg.includes(normalizedGenre) ||
					normalizedGenre.includes(sg),
			);

			if (hasMatch) {
				weightedMatch += count;
			}
		}

		if (totalWeight === 0) return 0;

		// Normalize to 0-1
		return weightedMatch / totalWeight;
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create MatchingService instance.
 */
export function createMatchingService(
	embeddingService: EmbeddingService | null,
	profilingService: PlaylistProfilingService | null,
	config?: Partial<MatchingConfig>,
): MatchingService {
	return new MatchingService(embeddingService, profilingService, config);
}

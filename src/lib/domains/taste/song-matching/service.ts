/**
 * Playlist matching service.
 *
 * Matches songs to playlists using multi-factor scoring:
 * - Vector similarity (embeddings)
 * - Genre overlap
 * - Audio feature similarity
 */

import { Result } from "better-result";
import type { JobProgress } from "@/lib/data/jobs";
import type { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import type { PlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import { computeAdaptiveWeights, DEFAULT_MATCHING_CONFIG } from "./config";
import { computeAudioFeatureScore } from "./scoring";
import { cosineSimilarity } from "./semantic";
import type {
	BatchMatchResult,
	DataAvailability,
	MatchingConfig,
	MatchingError,
	MatchingPlaylistProfile,
	MatchingSong,
	MatchingWeights,
	MatchResult,
	ScoreFactors,
} from "./types";

export interface BatchMatchOptions {
	/** Progress callback (optional) */
	onProgress?: (progress: JobProgress) => void;
	/** Song:playlist pairs to skip (format: "songId:playlistId") */
	exclusionSet?: Set<string>;
}

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

		// Assign ranks and filter by threshold
		const ranked = results
			.toSorted((a, b) => b.score - a.score)
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
	 * @param options - Optional batch options (progress callback, exclusion set)
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
				noMatch: [],
				excluded: [],
				stats: {
					total: 0,
					matched: 0,
					cached: 0,
					computed: 0,
					noMatch: 0,
					excluded: 0,
				},
			});
		}

		const { onProgress, exclusionSet } = options ?? {};
		const matches = new Map<string, MatchResult[]>();
		const noMatch: string[] = [];
		const excluded: string[] = [];
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

			// Filter out excluded playlists for this song
			const eligibleProfiles = exclusionSet
				? profiles.filter(
						(p) => !exclusionSet.has(`${song.id}:${p.playlistId}`),
					)
				: profiles;

			if (eligibleProfiles.length === 0) {
				excluded.push(song.id);
				progress.done++;
				onProgress?.(progress);
				continue;
			}

			const embedding = songEmbeddings?.get(song.id) ?? null;
			const result = await this.matchSong(song, eligibleProfiles, embedding);

			if (Result.isOk(result) && result.value.length > 0) {
				matches.set(song.id, result.value);
				computed++;
				progress.succeeded++;
			} else {
				noMatch.push(song.id);
				progress.failed++;
			}

			progress.done++;

			onProgress?.(progress);
		}

		return Result.ok({
			matches,
			noMatch,
			excluded,
			stats: {
				total: songs.length,
				matched: matches.size,
				cached: 0,
				computed,
				noMatch: noMatch.length,
				excluded: excluded.length,
			},
		});
	}

	/**
	 * Score a song against a playlist profile.
	 */
	private async scoreSongToPlaylist(
		song: MatchingSong,
		profile: MatchingPlaylistProfile,
		songEmbedding: number[] | null,
	): Promise<Result<MatchResult, MatchingError>> {
		const availability: DataAvailability = {
			hasEmbedding: !!songEmbedding && !!profile.embedding,
			hasGenres: !!song.genres && song.genres.length > 0,
			hasAudioFeatures:
				!!song.audioFeatures && Object.keys(profile.audioCentroid).length > 0,
		};

		const weights = computeAdaptiveWeights(availability, this.config.weights);

		const embeddingScore = this.computeVectorScore(
			songEmbedding,
			profile.embedding,
		);
		const audioScore = availability.hasAudioFeatures
			? computeAudioFeatureScore(
					song.audioFeatures!,
					profile.audioCentroid,
					this.config.audioWeights,
				)
			: 0;
		const genreScore = this.computeGenreScore(
			song.genres,
			profile.genreDistribution,
		);

		const factors: ScoreFactors = {
			embedding: embeddingScore,
			audio: audioScore,
			genre: genreScore,
		};

		const finalScore = this.computeFinalScore(factors, weights);

		const availableCount = Object.values(availability).filter(Boolean).length;
		const confidence = availableCount / 3;

		return Result.ok({
			songId: song.id,
			playlistId: profile.playlistId,
			score: Math.max(0, Math.min(1, finalScore)),
			rank: 0,
			factors,
			confidence,
			fromCache: false,
		});
	}

	/**
	 * Compute final weighted score from factors.
	 */
	private computeFinalScore(
		factors: ScoreFactors,
		weights: MatchingWeights,
	): number {
		return (
			factors.embedding * weights.embedding +
			factors.audio * weights.audio +
			factors.genre * weights.genre
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

		const similarity = cosineSimilarity(songEmbedding, playlistEmbedding);
		const baseline = this.config.similarityBaseline;

		// Stretch the naturally compressed cosine range: baseline→0, 1.0→1.0
		return Math.max(0, Math.min(1, (similarity - baseline) / (1 - baseline)));
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

/**
 * Playlist matching service.
 *
 * Matches songs to playlists using multi-factor scoring:
 * - Vector similarity (embeddings)
 * - Genre overlap
 * - Audio feature similarity
 */

import { Result } from "better-result";
import type { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { genreSimilarity } from "@/lib/domains/taste/genre-similarity/loader";
import type { PlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import type { JobProgress } from "@/lib/platform/jobs/repository";
import {
	ADJACENT_FLOOR,
	ADJACENT_MAX,
	computeAdaptiveWeights,
	DEFAULT_MATCHING_CONFIG,
	selectBaseWeights,
} from "./config";
import {
	computeSignalStats,
	normalizeSignal,
	type SignalStats,
	stretchFromBaseline,
} from "./normalization";
import { computeAudioFeatureScore } from "./scoring";
import { cosineSimilarity } from "./semantic";
import type {
	BatchMatchResult,
	DataAvailability,
	MatchingConfig,
	MatchingError,
	MatchingPlaylistProfile,
	MatchingSong,
	MatchResult,
	ScoreFactors,
} from "./types";

interface BatchMatchOptions {
	/** Progress callback (optional) */
	onProgress?: (progress: JobProgress) => void;
	/** Song:playlist pairs to skip (format: "songId:playlistId") */
	exclusionSet?: Set<string>;
}

/** A (song, profile) pair scored with raw factors, before normalization/fusion. */
interface RawScored {
	readonly song: MatchingSong;
	readonly profile: MatchingPlaylistProfile;
	readonly factors: ScoreFactors;
	readonly availability: DataAvailability;
}

/** Per-signal candidate-set distributions, computed over available pairs only. */
interface FactorStats {
	readonly embedding: SignalStats;
	readonly audio: SignalStats;
	readonly genre: SignalStats;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

/**
 * Map a raw similarity value from the genre table to a credit in [0, 1].
 *
 * Exact match (r === 1) → full credit 1.0.
 * Adjacent (r ∈ [ADJACENT_FLOOR, 1)) → capped at ADJACENT_MAX so adjacent
 *   genres (e.g. related edges at 0.5, subgenre edges at 0.6) yield partial
 *   credit, never the full 1.0 reserved for exact matches.
 * Below floor → 0 (unrelated; avoids signal from low-confidence entries).
 */
export function bandedCredit(r: number): number {
	if (r >= 1) return 1;
	if (r < ADJACENT_FLOOR) return 0;
	return Math.min(r, ADJACENT_MAX);
}

/**
 * Pure genre overlap score in [0, 1].
 *
 * For each playlist genre weighted by its distribution mass, the credit is the
 * best similarity any song genre achieves after banding. Score is the
 * mass-weighted average credit across all playlist genres. Scale-invariant, so
 * it is transparent to whether playlistDistribution holds raw counts or
 * fractions (Task 1.4 will switch to fractions).
 *
 * Exported for unit tests — the private method on MatchingService delegates
 * here so the pure logic is directly testable.
 */
export function scoreGenres(
	songGenres: string[],
	playlistDistribution: Record<string, number>,
): number {
	const playlistGenres = Object.keys(playlistDistribution);
	if (playlistGenres.length === 0) return 0;

	let weightedCredit = 0;
	let totalWeight = 0;

	for (const [g, w] of Object.entries(playlistDistribution)) {
		totalWeight += w;
		// Best credit this playlist genre gets from any song genre.
		let best = 0;
		for (const s of songGenres) {
			const credit = bandedCredit(genreSimilarity(g, s));
			if (credit > best) best = credit;
		}
		weightedCredit += w * best;
	}

	if (totalWeight === 0) return 0;
	return weightedCredit / totalWeight;
}

class MatchingService {
	private readonly config: MatchingConfig;

	constructor(
		_embeddingService: EmbeddingService | null,
		_profilingService: PlaylistProfilingService | null,
		config?: Partial<MatchingConfig>,
	) {
		const merged = { ...DEFAULT_MATCHING_CONFIG, ...config };
		// noEmbeddingMode implies skipVectorScoring so the embedding factor is
		// always 0, driving hasEmbedding=false in computeRawScored and causing
		// computeAdaptiveWeights to redistribute the embedding weight onto
		// audio+genre (see MatchingConfig.noEmbeddingMode for the exact math).
		this.config = merged.noEmbeddingMode
			? { ...merged, skipVectorScoring: true }
			: merged;
	}

	/**
	 * Match a single song to multiple playlists.
	 * Returns ranked results sorted by score descending.
	 *
	 * The candidate set here is just this song's profiles, so per-signal stats
	 * come from that (often small) set. With few playlists the stats are
	 * unreliable, so signals below `normalization.minSamples` take the legacy
	 * fallback scaling — see `matchBatch` for the well-sampled batch-global path
	 * used in production.
	 */
	matchSong(
		song: MatchingSong,
		profiles: MatchingPlaylistProfile[],
		songEmbedding?: number[] | null,
	): Result<MatchResult[], MatchingError> {
		if (profiles.length === 0) {
			return Result.ok([]);
		}

		const scored = profiles.map((profile) =>
			this.computeRawScored(song, profile, songEmbedding ?? null),
		);
		const stats = this.computeFactorStats(scored);
		const results = scored.map((s) => this.fuse(s, stats));

		return Result.ok(this.rankAndFilter(results));
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

		// Pass A: raw factor scores for every eligible (song, profile) pair across
		// the whole candidate matrix. Normalization stats are computed once over
		// this full set so scores stay comparable along both axes — per song (the
		// served ranking) and per playlist (the reranker's grouping).
		const perSong = new Map<string, RawScored[]>();
		const allScored: RawScored[] = [];

		for (const song of songs) {
			const eligibleProfiles = exclusionSet
				? profiles.filter(
						(p) => !exclusionSet.has(`${song.id}:${p.playlistId}`),
					)
				: profiles;

			if (eligibleProfiles.length === 0) {
				excluded.push(song.id);
				continue;
			}

			const embedding = songEmbeddings?.get(song.id) ?? null;
			const scored = eligibleProfiles.map((profile) =>
				this.computeRawScored(song, profile, embedding),
			);
			perSong.set(song.id, scored);
			for (const s of scored) allScored.push(s);
		}

		const stats = this.computeFactorStats(allScored);

		// Pass B: normalize, fuse, rank — per song.
		for (const song of songs) {
			const scored = perSong.get(song.id);
			if (!scored) {
				// Excluded: every playlist was filtered out for this song.
				progress.done++;
				onProgress?.(progress);
				continue;
			}

			const results = scored.map((s) => this.fuse(s, stats));
			const ranked = this.rankAndFilter(results);

			if (ranked.length > 0) {
				matches.set(song.id, ranked);
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
	 * Compute raw (un-normalized) factor scores for one (song, profile) pair.
	 * Fusion is deferred until candidate-set stats are known.
	 */
	private computeRawScored(
		song: MatchingSong,
		profile: MatchingPlaylistProfile,
		songEmbedding: number[] | null,
	): RawScored {
		const availability: DataAvailability = {
			hasEmbedding: !!songEmbedding && !!profile.embedding,
			hasGenres: !!song.genres && song.genres.length > 0,
			hasAudioFeatures:
				!!song.audioFeatures && Object.keys(profile.audioCentroid).length > 0,
		};

		const factors: ScoreFactors = {
			embedding: this.computeVectorScore(songEmbedding, profile.embedding),
			audio:
				availability.hasAudioFeatures && song.audioFeatures
					? computeAudioFeatureScore(
							song.audioFeatures,
							profile.audioCentroid,
							this.config.audioWeights,
						)
					: 0,
			genre: this.computeGenreScore(song.genres, profile.genreDistribution),
		};

		return { song, profile, factors, availability };
	}

	/**
	 * Compute per-signal distributions across a candidate set.
	 * Only pairs where a signal is available contribute to that signal's stats —
	 * a missing signal's implicit 0 must not drag the distribution.
	 */
	private computeFactorStats(scored: RawScored[]): FactorStats {
		const embedding: number[] = [];
		const audio: number[] = [];
		const genre: number[] = [];

		for (const s of scored) {
			if (s.availability.hasEmbedding) embedding.push(s.factors.embedding);
			if (s.availability.hasAudioFeatures) audio.push(s.factors.audio);
			if (s.availability.hasGenres) genre.push(s.factors.genre);
		}

		return {
			embedding: computeSignalStats(embedding),
			audio: computeSignalStats(audio),
			genre: computeSignalStats(genre),
		};
	}

	/**
	 * Normalize and fuse one pair's raw factors into a ranked MatchResult.
	 *
	 * Per-playlist base weights are selected here — after z-score stats are
	 * already computed over the whole candidate matrix — so pill-based weight
	 * selection never changes how the signal distributions are measured, only
	 * which multipliers are applied to the already-normalized factors.
	 */
	private fuse(scored: RawScored, stats: FactorStats): MatchResult {
		const { song, profile, factors, availability } = scored;
		const baseWeights = selectBaseWeights(this.config, profile.hasGenrePills);
		const weights = computeAdaptiveWeights(availability, baseWeights);

		const normalizedFactors: ScoreFactors = {
			embedding: this.normalizeFactor(
				factors.embedding,
				availability.hasEmbedding,
				stats.embedding,
				(v) =>
					stretchFromBaseline(
						v,
						this.config.normalization.fallbackSimilarityBaseline,
					),
			),
			audio: this.normalizeFactor(
				factors.audio,
				availability.hasAudioFeatures,
				stats.audio,
			),
			genre: this.normalizeFactor(
				factors.genre,
				availability.hasGenres,
				stats.genre,
			),
		};

		const finalScore =
			normalizedFactors.embedding * weights.embedding +
			normalizedFactors.audio * weights.audio +
			normalizedFactors.genre * weights.genre;

		const availableCount = Object.values(availability).filter(Boolean).length;
		const fusedScore = clamp01(finalScore);

		return {
			songId: song.id,
			playlistId: profile.playlistId,
			score: fusedScore,
			rank: 0,
			factors,
			normalizedFactors,
			// Captured here so it survives the reranker overwriting `score`.
			fusedScore,
			confidence: availableCount / 3,
			fromCache: false,
		};
	}

	/**
	 * Normalize a single factor against its candidate-set distribution.
	 * Unavailable signals contribute 0 (their weight is already redistributed).
	 * When normalization can't be trusted (disabled, or under-sampled so the
	 * stats would be noise), the signal takes `fallback` instead — the legacy
	 * scaling for signals whose raw range is compressed — or passes through raw.
	 */
	private normalizeFactor(
		value: number,
		available: boolean,
		stats: SignalStats,
		fallback?: (value: number) => number,
	): number {
		if (!available) return 0;
		const { enabled, method, minSamples } = this.config.normalization;
		if (!enabled || stats.n < minSamples) {
			return fallback ? fallback(value) : clamp01(value);
		}
		return normalizeSignal(value, stats, method);
	}

	/**
	 * Sort by score, drop sub-threshold matches, cap to top-K, assign ranks.
	 */
	private rankAndFilter(results: MatchResult[]): MatchResult[] {
		return results
			.toSorted((a, b) => b.score - a.score)
			.filter((r) => r.score >= this.config.minScoreThreshold)
			.slice(0, this.config.maxResultsPerSong)
			.map((r, i) => ({ ...r, rank: i + 1 }));
	}

	/**
	 * Compute raw vector similarity score (cosine, clamped to [0,1]).
	 * No baseline stretch here — candidate-set normalization restores the
	 * embedding signal's differential influence at fusion time, and stats must
	 * be computed over raw cosines. The legacy stretch survives only as the
	 * fallback inside `normalizeFactor`.
	 */
	private computeVectorScore(
		songEmbedding: number[] | null,
		playlistEmbedding: number[] | null,
	): number {
		if (!songEmbedding || !playlistEmbedding) return 0;
		if (this.config.skipVectorScoring) return 0;

		return clamp01(cosineSimilarity(songEmbedding, playlistEmbedding));
	}

	/**
	 * Compute genre overlap score via similarity-table banding.
	 * Delegates to the exported pure helper `scoreGenres` so it's unit-testable.
	 *
	 * The early return 0 for empty/null song genres is a harmless no-op:
	 * `computeRawScored` sets `availability.hasGenres = false` when genres is
	 * empty, so `computeFactorStats` never includes this value in its genre
	 * distribution, and `computeAdaptiveWeights` redistributes the genre weight
	 * away entirely. The 0 is never fused as a real signal.
	 */
	private computeGenreScore(
		songGenres: string[] | null,
		playlistDistribution: Record<string, number>,
	): number {
		if (!songGenres || songGenres.length === 0) return 0;
		return scoreGenres(songGenres, playlistDistribution);
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

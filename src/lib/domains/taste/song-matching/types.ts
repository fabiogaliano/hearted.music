/**
 * Matching pipeline types.
 *
 * Defines result structures for song-to-playlist matching.
 */

import { TaggedError } from "better-result";
import type { MLProviderError } from "@/lib/shared/errors/domain/ml";
import type { NormalizationMethod } from "./normalization";

export interface ScoreFactors {
	readonly embedding: number;
	readonly audio: number;
	readonly genre: number;
}

/** Result of matching a song to a playlist */
export interface MatchResult {
	/** Song's internal UUID */
	readonly songId: string;
	/** Playlist's internal UUID */
	readonly playlistId: string;
	/**
	 * Score used for ranking and shown to the user. Equals `fusedScore` until the
	 * reranker runs, which overwrites it with the reranked score (see `rerankedScore`).
	 */
	readonly score: number;
	/** Rank within match results (1-based) */
	readonly rank: number;
	/** Raw per-signal factor scores, before candidate-set normalization */
	readonly factors: ScoreFactors;
	/** Normalized factor scores actually fused into `score` (the weighted-sum inputs) */
	readonly normalizedFactors: ScoreFactors;
	/**
	 * Pre-rerank weighted-sum of the normalized factors. Set once at fusion time
	 * and never overwritten by the reranker, so the retrieval score survives even
	 * when `score` is replaced by the reranked value — the served record keeps both.
	 */
	readonly fusedScore: number;
	/** Cross-encoder reranked score, if reranking was applied */
	readonly rerankedScore?: number;
	/** Confidence in the match (based on data availability) */
	readonly confidence: number;
	/** Whether result came from cache */
	readonly fromCache: boolean;
}

/** Batch matching result */
export interface BatchMatchResult {
	/** Matches keyed by songId */
	readonly matches: Map<string, MatchResult[]>;
	/** Songs that scored below threshold against all playlists */
	readonly noMatch: string[];
	/** Songs skipped because all playlists were in the exclusion set */
	readonly excluded: string[];
	/** Statistics */
	readonly stats: {
		readonly total: number;
		readonly matched: number;
		readonly cached: number;
		readonly computed: number;
		readonly noMatch: number;
		readonly excluded: number;
	};
}

/** Weights for combining score factors */
export interface MatchingWeights {
	readonly embedding: number;
	readonly audio: number;
	readonly genre: number;
}

/** Audio feature weights for similarity calculation */
export interface AudioFeatureWeights {
	readonly energy: number;
	readonly valence: number;
	readonly danceability: number;
	readonly acousticness: number;
	readonly instrumentalness: number;
	readonly speechiness: number;
	readonly liveness: number;
	readonly tempo: number;
	readonly loudness: number;
}

/** Per-signal normalization applied across the candidate set before fusion */
export interface NormalizationConfig {
	/** When false, every signal takes the fallback path below */
	readonly enabled: boolean;
	/** Normalization method: z-score (DBSF-style) or min-max */
	readonly method: NormalizationMethod;
	/**
	 * Minimum available samples for a signal before its distribution is trusted.
	 * Below this, that signal takes the fallback path instead of being
	 * normalized — guards the small single-song candidate sets from unstable
	 * stats. The batch path is always well above this floor.
	 */
	readonly minSamples: number;
	/**
	 * Baseline for the legacy embedding stretch (baseline→0, 1.0→1.0) applied
	 * on the fallback path. Audio/genre already span 0–1 and pass through raw
	 * there.
	 */
	readonly fallbackSimilarityBaseline: number;
}

/** Full matching configuration */
export interface MatchingConfig {
	/** Score factor weights (used when the playlist has no declared genre pills) */
	readonly weights: MatchingWeights;
	/**
	 * Weights used when the playlist has declared genre pills.
	 * Genre is boosted from 0.20 → 0.40 (strong-steer decision) while embedding
	 * and audio are trimmed proportionally. Provisional; replay-tunable.
	 */
	readonly weightsWithDeclaredGenres: MatchingWeights;
	/** Audio feature weights */
	readonly audioWeights: AudioFeatureWeights;
	/** Minimum fused (normalized) score to include in results */
	readonly minScoreThreshold: number;
	/** Maximum results per song */
	readonly maxResultsPerSong: number;
	/** Skip vector scoring (for testing) */
	readonly skipVectorScoring: boolean;
	/**
	 * No-embedding scoring mode.
	 *
	 * When true, vector scoring is disabled entirely and the embedding weight is
	 * redistributed proportionally onto audio and genre by computeAdaptiveWeights.
	 * This is the path used by the free-tier playlist-creation preview engine,
	 * which scores candidates using only Phase-1 (deterministic) signals.
	 *
	 * Effect on default weights (embedding 0.5, audio 0.3, genre 0.2):
	 *   embedding drops out → 0.5 redistributed to remaining in proportion.
	 *   audio  = 0.3 + 0.5 × (0.3 / 0.5) = 0.60
	 *   genre  = 0.2 + 0.5 × (0.2 / 0.5) = 0.40
	 *
	 * Effect on pill weights (embedding 0.35, audio 0.25, genre 0.40):
	 *   audio  = 0.25 + 0.35 × (0.25 / 0.65) ≈ 0.385
	 *   genre  = 0.40 + 0.35 × (0.40 / 0.65) ≈ 0.615
	 *
	 * Both cases sum to 1.0 by construction (computeAdaptiveWeights invariant).
	 * Enabling this flag automatically sets skipVectorScoring and must be
	 * combined with passing no song embeddings to matchBatch so hasEmbedding
	 * is false for every candidate — triggering the redistribution path.
	 */
	readonly noEmbeddingMode?: boolean;
	/** Per-signal candidate-set normalization before fusion */
	readonly normalization: NormalizationConfig;
}

/** Missing required data for matching */
class MatchingDataError extends TaggedError("MatchingDataError")<{
	message: string;
	songId?: string;
	playlistId?: string;
}>() {
	constructor(message: string, songId?: string, playlistId?: string) {
		super({ message, songId, playlistId });
	}
}

/** Computation error during matching */
class MatchingComputeError extends TaggedError("MatchingComputeError")<{
	message: string;
	cause?: unknown;
}>() {
	constructor(message: string, cause?: unknown) {
		super({ message, cause });
	}
}

/** Union of matching errors */
export type MatchingError =
	| MatchingDataError
	| MatchingComputeError
	| MLProviderError;

/** Tracks which data sources are available for a song */
export interface DataAvailability {
	readonly hasEmbedding: boolean;
	readonly hasGenres: boolean;
	readonly hasAudioFeatures: boolean;
}

/** Audio features for matching (subset of ReccoBeats features) */
export interface MatchingAudioFeatures {
	readonly energy: number;
	readonly valence: number;
	readonly danceability: number;
	readonly acousticness: number;
	readonly instrumentalness: number;
	readonly speechiness: number;
	readonly liveness: number;
	readonly tempo: number;
	readonly loudness: number;
}

/** Song data needed for matching */
export interface MatchingSong {
	readonly id: string;
	readonly spotifyId: string;
	readonly name: string;
	readonly artists: string[];
	readonly genres: string[] | null;
	/** Audio features (optional - enables audio scoring) */
	readonly audioFeatures?: MatchingAudioFeatures | null;
}

/** Playlist profile data needed for matching */
export interface MatchingPlaylistProfile {
	readonly playlistId: string;
	readonly embedding: number[] | null;
	readonly audioCentroid: Record<string, number>;
	readonly genreDistribution: Record<string, number>;
	/**
	 * True when the user has declared at least one genre pill for this playlist.
	 * The matcher uses this to select a higher genre weight (0.40 vs 0.20).
	 * A boolean is sufficient here — the matcher only needs presence/absence to
	 * pick the base weight set; the actual pill list already lives in the profile's
	 * genreDistribution blend (Task 1.4) and intent text (Task 1.4), so carrying
	 * it again on this interface would be redundant.
	 */
	readonly hasGenrePills: boolean;
}

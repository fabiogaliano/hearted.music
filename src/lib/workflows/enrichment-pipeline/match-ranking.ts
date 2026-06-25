/**
 * Oriented ranking contracts for the match enrichment pipeline.
 *
 * Types and constants used by both the ranking write path (MSR-12–15) and the
 * presentation/capture path (MSR-22). Actual ranking behavior is not wired
 * here; this module is a compile-stable shared contract (MSR-04).
 */

import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import { DEFAULT_RERANK_INSTRUCTION } from "@/lib/integrations/providers/types";

export type { MatchOrientation };

/**
 * Source that determined the final ordering score for a ranked pair (B7).
 * 'rerank'        = cross-encoder provider returned a score.
 * 'fused_fallback' = no provider score; fused_score used directly.
 */
export type RankingSource = "rerank" | "fused_fallback";

/**
 * Document richness used when building reranker input documents (B8).
 * 'analysis' = metadata prefix + truncated analysis prose.
 * 'metadata' = metadata prefix only (name + artists + genres).
 */
export type RankingDocumentMode = "analysis" | "metadata";

/**
 * A single (song, playlist) pair with its ranking-write-time scores (E1, B6).
 *
 * orderingScore is the authoritative sort key stored in match_result_ranking.
 * rerankerScore is the raw cross-encoder score when source is 'rerank'; null
 * when source is 'fused_fallback'.
 */
export interface RankedPair {
	songId: string;
	playlistId: string;
	orderingScore: number;
	rerankerScore: number | null;
	source: RankingSource;
	documentMode: RankingDocumentMode;
}

/**
 * The full oriented ranking output for one review subject (E1, D).
 *
 * Each value represents one subject (song or playlist, per orientation) with
 * its suggestion pairs ordered by descending orderingScore (index 0 = rank 1).
 * Downstream ranking write stages (MSR-12–15) emit arrays of this type.
 */
export interface RankedSuggestionLists {
	orientation: MatchOrientation;
	/** Subject ID (songId when orientation is 'song'; playlistId when 'playlist'). */
	subjectId: string;
	/** Ordered pairs, index 0 is rank 1 (highest orderingScore). */
	rankedPairs: RankedPair[];
}

/**
 * Both orientations are always computed; no env flag gates individual
 * orientations in the initial refactor (G1, G5).
 */
export const MATCH_RANKING_ORIENTATIONS: readonly MatchOrientation[] = [
	"song",
	"playlist",
] as const;

/**
 * Schema version baked into rankingConfigHash. Bump this value whenever the
 * ranking schema changes in a way that should invalidate stored rankings (G2).
 */
export const MATCH_RANKING_SCHEMA_VERSION = "oriented-suggestion-lists-v1";

/**
 * Per-orientation task instruction forwarded to the cross-encoder (E3).
 *
 * Song orientation:     query = playlist profile,  document = song metadata/analysis.
 * Playlist orientation: query = song profile,       document = playlist metadata.
 */
export const RERANK_INSTRUCTION_BY_ORIENTATION: Readonly<
	Record<MatchOrientation, string>
> = {
	song: DEFAULT_RERANK_INSTRUCTION,
	playlist:
		"Given a song's mood and themes, judge if this playlist is a good home for it.",
} as const;

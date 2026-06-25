/**
 * Oriented ranking contracts and document builders for the match enrichment
 * pipeline.
 *
 * Types and constants used by both the ranking write path (MSR-12–15) and the
 * presentation/capture path (MSR-22). Document builders live here so MSR-14/15
 * can call them directly without duplicating the formatting logic that already
 * existed in reranking.ts.
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

// ============================================================================
// Document builders (E5)
// ============================================================================

/**
 * Maximum character budget for the analysis tail portion of a song document.
 * ~400 tokens × 4 chars/token with a reserve for metadata prefix and template
 * overhead. Truncation always falls on a word boundary.
 */
export const ANALYSIS_TAIL_MAX_CHARS = 1600;

/** Input for building a song reranker document. */
export interface SongRerankDocumentInput {
	readonly name: string;
	readonly artists: readonly string[];
	readonly genres: readonly string[] | null;
	/** When provided, appended after the metadata prefix (analysis mode). */
	readonly analysisText?: string | null;
}

/** Input for building a playlist reranker document. */
export interface PlaylistRerankDocumentInput {
	readonly name: string;
	readonly matchIntent?: string | null;
	readonly genrePills?: readonly string[] | null;
}

/** Pair of (document string, document mode) returned by the builders. */
export interface RerankDocumentResult {
	readonly document: string;
	readonly documentMode: RankingDocumentMode;
}

/**
 * Builds the reranker document for a song candidate (E5, song orientation).
 *
 * When analysisText is provided and non-empty the document is 'analysis' mode
 * (metadata prefix + truncated prose). Otherwise it is 'metadata' mode
 * (metadata prefix only). The format is identical to the inline document
 * construction in reranking.ts so both paths produce byte-compatible strings.
 */
export function buildSongRerankDocument(
	song: SongRerankDocumentInput,
): RerankDocumentResult {
	const genres = song.genres?.join(", ") ?? "";
	const metadataPrefix = `${song.name} by ${song.artists.join(", ")}. Genres: ${genres}.`;

	const rawAnalysis = song.analysisText;
	if (rawAnalysis) {
		// Truncate at a word boundary so the total doc stays within ~400 tokens.
		let tail = rawAnalysis;
		if (tail.length > ANALYSIS_TAIL_MAX_CHARS) {
			const slice = tail.slice(0, ANALYSIS_TAIL_MAX_CHARS);
			const lastSpace = slice.lastIndexOf(" ");
			tail = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
		}
		return {
			document: `${metadataPrefix}\n\n${tail}`,
			documentMode: "analysis",
		};
	}

	return { document: metadataPrefix, documentMode: "metadata" };
}

/**
 * Builds the reranker document for a playlist candidate (E5, playlist
 * orientation).
 *
 * The format mirrors buildIntentText (playlist-profiling/calculations.ts) so
 * the document is byte-compatible with how playlists are described in profile
 * embeddings. Playlists carry no separate analysis prose, so this always
 * returns 'metadata' mode.
 */
export function buildPlaylistRerankDocument(
	playlist: PlaylistRerankDocumentInput,
): RerankDocumentResult {
	// Match the intent-text separator used in playlist profile embeddings so
	// the cross-encoder sees a familiar format for this content type.
	const intentPart = playlist.matchIntent ? ` — ${playlist.matchIntent}` : "";
	const activePills = playlist.genrePills?.filter((p) => p.length > 0) ?? [];
	const genrePart =
		activePills.length > 0 ? `. Genres: ${activePills.join(", ")}` : "";

	return {
		document: `${playlist.name}${intentPart}${genrePart}`,
		documentMode: "metadata",
	};
}

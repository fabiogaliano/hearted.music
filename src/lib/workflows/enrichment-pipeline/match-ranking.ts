/**
 * Oriented ranking contracts and document builders for the match enrichment
 * pipeline.
 *
 * Types and constants used by both the ranking write path (MSR-12–15) and the
 * presentation/capture path (MSR-22). Document builders live here so MSR-14/15
 * can call them directly without duplicating the formatting logic that already
 * existed in reranking.ts.
 */

import { Result } from "better-result";
import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import { DEFAULT_RERANK_INSTRUCTION } from "@/lib/integrations/providers/types";
import type {
	MatchCandidate,
	RerankerService,
} from "@/lib/integrations/reranker/service";
import { log } from "@/lib/observability/logger";

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
 * Song orientation:     query = song document (metadata/analysis),  candidates = playlist documents.
 * Playlist orientation: query = playlist document,                   candidates = song documents.
 */
export const RERANK_INSTRUCTION_BY_ORIENTATION: Readonly<
	Record<MatchOrientation, string>
> = {
	song: DEFAULT_RERANK_INSTRUCTION,
	playlist:
		"Given a song's mood and themes, judge if this playlist is a good home for it.",
} as const;

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

/**
 * Minimal stored pair fields needed by the song-orientation ranker.
 * Accepts any superset (e.g. full MatchResult) without importing the whole type.
 */
export interface StoredMatchPairForRanking {
	readonly songId: string;
	readonly playlistId: string;
	/** Pre-rerank fused retrieval score. Used as orderingScore for fused_fallback rows. */
	readonly fusedScore: number;
}

/** Song metadata needed to build the reranker query document. */
export interface SongForRanking extends SongRerankDocumentInput {
	readonly id: string;
}

/** Playlist metadata needed to build reranker candidate documents. */
export interface PlaylistForRanking extends PlaylistRerankDocumentInput {
	readonly id: string;
}

/**
 * Combined result returned by the combined entry point (MSR-15, E2/E1/D).
 *
 * 'completed'  – all requested orientations finished without interruption.
 * 'superseded' – isSuperseded fired mid-run; byOrientation may be partial.
 */
export interface RankMatchSuggestionListsResult {
	status: "completed" | "superseded";
	byOrientation: Map<MatchOrientation, RankedSuggestionLists[]>;
}

/**
 * Rank each song's playlist suggestions using the song as query and playlists
 * as cross-encoder candidate documents (E1, E5, song orientation).
 *
 * For each song present in storedPairs:
 *   1. Build a query document from the song's metadata (+ optional analysis prose).
 *   2. Build a candidate document for every stored playlist suggestion.
 *   3. Call the reranker with the song-orientation instruction.
 *   4. Assign RankedPair fields:
 *      - Reranked candidates: source='rerank', orderingScore=blended score,
 *        rerankerScore=raw provider score.
 *      - Tail candidates (below threshold or not sent): source='fused_fallback',
 *        orderingScore=fusedScore, rerankerScore=null.
 *   5. Sort by orderingScore desc then playlistId asc and assign dense ranks.
 *
 * Returns one RankedSuggestionLists per song. Songs missing from the `songs`
 * array still produce a result — every pair falls back to fused_fallback
 * ordering since no query document can be built.
 *
 * isSuperseded is checked between suggestion lists so a superseded job stops
 * early and returns the partial results accumulated so far (MSR-15).
 */
export async function rankSongSuggestionLists(params: {
	storedPairs: readonly StoredMatchPairForRanking[];
	songs: readonly SongForRanking[];
	playlists: readonly PlaylistForRanking[];
	rerankerService: RerankerService;
	/** Optional checkpoint: if it returns true between iterations, ranking stops early. */
	isSuperseded?: () => Promise<boolean>;
}): Promise<RankedSuggestionLists[]> {
	const { storedPairs, songs, playlists, rerankerService, isSuperseded } =
		params;

	const songMap = new Map(songs.map((s) => [s.id, s]));
	const playlistMap = new Map(playlists.map((p) => [p.id, p]));

	// Group stored pairs by song — do not mutate the input array.
	const bySong = new Map<string, StoredMatchPairForRanking[]>();
	for (const pair of storedPairs) {
		let bucket = bySong.get(pair.songId);
		if (!bucket) {
			bucket = [];
			bySong.set(pair.songId, bucket);
		}
		bucket.push(pair);
	}

	let songsReranked = 0;
	let songsSkipped = 0;

	const results: RankedSuggestionLists[] = [];

	for (const [songId, pairs] of bySong) {
		// Superseded checkpoint between suggestion lists (MSR-15). Stops early
		// so a newer job can proceed without waiting for remaining songs.
		if (isSuperseded && (await isSuperseded())) {
			log.info("rank-song:superseded", { rankedSoFar: results.length });
			break;
		}
		const song = songMap.get(songId);

		// Build the query document from the song. When song metadata is missing
		// we cannot produce a meaningful reranker query, so all pairs fall back.
		const queryResult = song ? buildSongRerankDocument(song) : null;

		// Stable pre-sort: fusedScore desc, playlistId asc — determines ordering
		// within fused_fallback buckets and the initial candidate order passed to
		// the reranker (higher-confidence pairs rank first before cross-encoding).
		const sortedPairs = pairs.toSorted(
			(a, b) =>
				b.fusedScore - a.fusedScore || a.playlistId.localeCompare(b.playlistId),
		);

		// Map playlistId → fusedScore for fast lookup when building ranked pairs.
		const fusedScoreByPlaylist = new Map(
			sortedPairs.map((p) => [p.playlistId, p.fusedScore]),
		);

		// Build reranker candidates: playlist document as the ranked document.
		const candidates: MatchCandidate[] = sortedPairs.map((pair) => {
			const playlist = playlistMap.get(pair.playlistId);
			const { document: doc } = playlist
				? buildPlaylistRerankDocument(playlist)
				: { document: pair.playlistId };
			return {
				id: pair.playlistId,
				score: pair.fusedScore,
				document: doc,
			};
		});

		// Produce fused_fallback ranked pairs using stable pre-sort order.
		// Array index 0 = rank 1; no rank field on RankedPair (implied by position).
		const makeFusedFallbackPairs = (): RankedPair[] =>
			sortedPairs.map((pair) => {
				const playlist = playlistMap.get(pair.playlistId);
				const documentMode: RankingDocumentMode = playlist
					? buildPlaylistRerankDocument(playlist).documentMode
					: "metadata";
				return {
					songId,
					playlistId: pair.playlistId,
					orderingScore: pair.fusedScore,
					rerankerScore: null,
					source: "fused_fallback" as const,
					documentMode,
				};
			});

		// Skip reranking when no query document is available.
		if (!queryResult) {
			results.push({
				orientation: "song",
				subjectId: songId,
				rankedPairs: makeFusedFallbackPairs(),
			});
			songsSkipped++;
			continue;
		}

		const rerankResult = await rerankerService.rerank(
			queryResult.document,
			candidates,
			{ instruction: RERANK_INSTRUCTION_BY_ORIENTATION.song },
		);

		if (Result.isError(rerankResult) || !rerankResult.value.reranked) {
			// Reranker failed or returned reranked:false — fall back entirely.
			results.push({
				orientation: "song",
				subjectId: songId,
				rankedPairs: makeFusedFallbackPairs(),
			});
			if (Result.isError(rerankResult)) {
				log.warn("rank-song:reranker-failed", {
					songId,
					error: rerankResult.error.message,
				});
			}
			songsSkipped++;
			continue;
		}

		songsReranked++;

		// Build ranked pairs from the reranker result. The returned candidates
		// array interleaves reranked entries (with metadata.rerank_score set) and
		// unreranked tail entries (no rerank_score). Distinguish by presence of the
		// raw score in metadata.
		const rankedPairs: RankedPair[] = rerankResult.value.candidates.map(
			(candidate) => {
				const rawScore = candidate.metadata?.rerank_score;
				const isReranked = typeof rawScore === "number";
				const fusedScore = fusedScoreByPlaylist.get(candidate.id) ?? 0;

				const playlist = playlistMap.get(candidate.id);
				const documentMode: RankingDocumentMode = playlist
					? buildPlaylistRerankDocument(playlist).documentMode
					: "metadata";

				return {
					songId,
					playlistId: candidate.id,
					// Reranked rows use the blended score as the authoritative sort key.
					// Fused-fallback rows use the pre-rerank fusedScore so the ordering
					// is strictly determined by retrieval quality alone.
					orderingScore: isReranked ? candidate.score : fusedScore,
					rerankerScore: isReranked ? rawScore : null,
					source: isReranked
						? ("rerank" as const)
						: ("fused_fallback" as const),
					documentMode,
				};
			},
		);

		// Dense-rank by orderingScore desc, playlistId asc — index already sorted
		// by the reranker's ordering (reranked block sorted by blended score, tail
		// preserves original order). Re-sort to collapse any interleaving.
		// Array index 0 = rank 1 per RankedSuggestionLists contract.
		const finalPairs = rankedPairs.toSorted(
			(a, b) =>
				b.orderingScore - a.orderingScore ||
				a.playlistId.localeCompare(b.playlistId),
		);

		results.push({
			orientation: "song",
			subjectId: songId,
			rankedPairs: finalPairs,
		});
	}

	log.info("rank-song:done", {
		songs: `${songsReranked}/${bySong.size}`,
		skipped: songsSkipped,
	});

	return results;
}

/**
 * Rank each playlist's song suggestions using the playlist as query and songs
 * as cross-encoder candidate documents (E1, E5, playlist orientation, MSR-15).
 *
 * Mirror of rankSongSuggestionLists with inverted roles:
 *   query   = buildPlaylistRerankDocument(playlist)
 *   candidates = buildSongRerankDocument(song) for each song paired with this playlist
 *
 * For each playlist present in storedPairs:
 *   1. Build a query document from the playlist metadata (name + intent + pills).
 *   2. Build a candidate document for every stored song suggestion.
 *   3. Call the reranker with the playlist-orientation instruction.
 *   4. Assign RankedPair fields:
 *      - Reranked candidates: source='rerank', orderingScore=blended score,
 *        rerankerScore=raw provider score.
 *      - Tail candidates (below threshold or not sent): source='fused_fallback',
 *        orderingScore=fusedScore, rerankerScore=null.
 *   5. Sort by orderingScore desc then songId asc and assign dense ranks.
 *
 * documentMode is derived from the song candidate document (songs can be
 * 'analysis' mode when analysis prose is available; playlists are always
 * 'metadata'). This is the converse of song orientation where the candidate
 * playlist document always produces 'metadata'.
 *
 * isSuperseded is checked between suggestion lists so a superseded job stops
 * early and returns the partial results accumulated so far.
 */
export async function rankPlaylistSuggestionLists(params: {
	storedPairs: readonly StoredMatchPairForRanking[];
	songs: readonly SongForRanking[];
	playlists: readonly PlaylistForRanking[];
	rerankerService: RerankerService;
	/** Optional checkpoint: if it returns true between iterations, ranking stops early. */
	isSuperseded?: () => Promise<boolean>;
}): Promise<RankedSuggestionLists[]> {
	const { storedPairs, songs, playlists, rerankerService, isSuperseded } =
		params;

	const songMap = new Map(songs.map((s) => [s.id, s]));
	const playlistMap = new Map(playlists.map((p) => [p.id, p]));

	// Group stored pairs by playlist — do not mutate the input array.
	const byPlaylist = new Map<string, StoredMatchPairForRanking[]>();
	for (const pair of storedPairs) {
		let bucket = byPlaylist.get(pair.playlistId);
		if (!bucket) {
			bucket = [];
			byPlaylist.set(pair.playlistId, bucket);
		}
		bucket.push(pair);
	}

	let playlistsReranked = 0;
	let playlistsSkipped = 0;

	const results: RankedSuggestionLists[] = [];

	for (const [playlistId, pairs] of byPlaylist) {
		// Superseded checkpoint between suggestion lists (MSR-15). Stops early
		// so a newer job can proceed without waiting for remaining playlists.
		if (isSuperseded && (await isSuperseded())) {
			log.info("rank-playlist:superseded", { rankedSoFar: results.length });
			break;
		}

		const playlist = playlistMap.get(playlistId);

		// Build the query document from the playlist. When playlist metadata is
		// missing we cannot produce a meaningful reranker query, so all pairs fall back.
		const queryResult = playlist ? buildPlaylistRerankDocument(playlist) : null;

		// Stable pre-sort: fusedScore desc, songId asc — determines ordering
		// within fused_fallback buckets and the initial candidate order passed to
		// the reranker (higher-confidence pairs rank first before cross-encoding).
		const sortedPairs = pairs.toSorted(
			(a, b) => b.fusedScore - a.fusedScore || a.songId.localeCompare(b.songId),
		);

		// Map songId → fusedScore for fast lookup when building ranked pairs.
		const fusedScoreBySong = new Map(
			sortedPairs.map((p) => [p.songId, p.fusedScore]),
		);

		// Build reranker candidates: song document as the ranked document.
		const candidates: MatchCandidate[] = sortedPairs.map((pair) => {
			const song = songMap.get(pair.songId);
			const { document: doc } = song
				? buildSongRerankDocument(song)
				: { document: pair.songId };
			return {
				id: pair.songId,
				score: pair.fusedScore,
				document: doc,
			};
		});

		// Produce fused_fallback ranked pairs using stable pre-sort order.
		// documentMode comes from the song document since songs can be 'analysis' mode.
		const makeFusedFallbackPairs = (): RankedPair[] =>
			sortedPairs.map((pair) => {
				const song = songMap.get(pair.songId);
				const documentMode: RankingDocumentMode = song
					? buildSongRerankDocument(song).documentMode
					: "metadata";
				return {
					songId: pair.songId,
					playlistId,
					orderingScore: pair.fusedScore,
					rerankerScore: null,
					source: "fused_fallback" as const,
					documentMode,
				};
			});

		// Skip reranking when no query document is available.
		if (!queryResult) {
			results.push({
				orientation: "playlist",
				subjectId: playlistId,
				rankedPairs: makeFusedFallbackPairs(),
			});
			playlistsSkipped++;
			continue;
		}

		const rerankResult = await rerankerService.rerank(
			queryResult.document,
			candidates,
			{ instruction: RERANK_INSTRUCTION_BY_ORIENTATION.playlist },
		);

		if (Result.isError(rerankResult) || !rerankResult.value.reranked) {
			// Reranker failed or returned reranked:false — fall back entirely.
			results.push({
				orientation: "playlist",
				subjectId: playlistId,
				rankedPairs: makeFusedFallbackPairs(),
			});
			if (Result.isError(rerankResult)) {
				log.warn("rank-playlist:reranker-failed", {
					playlistId,
					error: rerankResult.error.message,
				});
			}
			playlistsSkipped++;
			continue;
		}

		playlistsReranked++;

		// Build ranked pairs from the reranker result. Distinguish reranked
		// candidates (metadata.rerank_score present) from tail candidates (no score).
		const rankedPairs: RankedPair[] = rerankResult.value.candidates.map(
			(candidate) => {
				const rawScore = candidate.metadata?.rerank_score;
				const isReranked = typeof rawScore === "number";
				const fusedScore = fusedScoreBySong.get(candidate.id) ?? 0;

				const song = songMap.get(candidate.id);
				const documentMode: RankingDocumentMode = song
					? buildSongRerankDocument(song).documentMode
					: "metadata";

				return {
					songId: candidate.id,
					playlistId,
					orderingScore: isReranked ? candidate.score : fusedScore,
					rerankerScore: isReranked ? rawScore : null,
					source: isReranked
						? ("rerank" as const)
						: ("fused_fallback" as const),
					documentMode,
				};
			},
		);

		// Dense-rank by orderingScore desc, songId asc — re-sort to collapse any
		// interleaving between reranked block and tail.
		// Array index 0 = rank 1 per RankedSuggestionLists contract.
		const finalPairs = rankedPairs.toSorted(
			(a, b) =>
				b.orderingScore - a.orderingScore || a.songId.localeCompare(b.songId),
		);

		results.push({
			orientation: "playlist",
			subjectId: playlistId,
			rankedPairs: finalPairs,
		});
	}

	log.info("rank-playlist:done", {
		playlists: `${playlistsReranked}/${byPlaylist.size}`,
		skipped: playlistsSkipped,
	});

	return results;
}

/**
 * Combined entry point that produces RankedSuggestionLists for every requested
 * orientation (MSR-15, E2 D). Iterates MATCH_RANKING_ORIENTATIONS (or a subset
 * provided by the caller) and delegates to the per-orientation rankers.
 *
 * isSuperseded is forwarded into each per-orientation ranking loop AND checked
 * between orientations so the job can stop before starting the next orientation.
 *
 * Returns status='superseded' when isSuperseded fired at any checkpoint.
 * byOrientation always contains the partial or complete results collected before
 * the stop, so callers can decide whether to publish or discard.
 */
export async function rankMatchSuggestionLists(params: {
	orientations?: readonly MatchOrientation[];
	storedPairs: readonly StoredMatchPairForRanking[];
	songs: readonly SongForRanking[];
	playlists: readonly PlaylistForRanking[];
	rerankerService: RerankerService;
	/** Optional checkpoint forwarded into per-orientation loops and checked between orientations. */
	isSuperseded?: () => Promise<boolean>;
}): Promise<RankMatchSuggestionListsResult> {
	const {
		storedPairs,
		songs,
		playlists,
		rerankerService,
		isSuperseded,
		orientations = MATCH_RANKING_ORIENTATIONS,
	} = params;

	const byOrientation = new Map<MatchOrientation, RankedSuggestionLists[]>();

	for (const orientation of orientations) {
		// Check before starting each orientation so a superseded job does not
		// begin an expensive full-orientation ranking pass unnecessarily.
		if (isSuperseded && (await isSuperseded())) {
			log.info("rank-match:superseded-before-orientation", { orientation });
			return { status: "superseded", byOrientation };
		}

		if (orientation === "song") {
			const rankedLists = await rankSongSuggestionLists({
				storedPairs,
				songs,
				playlists,
				rerankerService,
				isSuperseded,
			});
			byOrientation.set("song", rankedLists);
		} else {
			const rankedLists = await rankPlaylistSuggestionLists({
				storedPairs,
				songs,
				playlists,
				rerankerService,
				isSuperseded,
			});
			byOrientation.set("playlist", rankedLists);
		}

		// Check immediately after each orientation before moving to the next.
		if (isSuperseded && (await isSuperseded())) {
			log.info("rank-match:superseded-after-orientation", { orientation });
			return { status: "superseded", byOrientation };
		}
	}

	return { status: "completed", byOrientation };
}

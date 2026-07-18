/**
 * Oriented ranking stage — reranks the retained pairs per orientation (song,
 * playlist), producing the ranking rows and the legacy score/rank mirror
 * (C12: song-orientation ordering_score/rank mirrored onto match_result's
 * score/rank columns for old read paths) that publishing writes out.
 */

import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import { get as getSongAnalyses } from "@/lib/domains/enrichment/content-analysis/queries";
import { flattenAnalysisText } from "@/lib/domains/enrichment/embeddings/analysis-text";
import type { MatchResult } from "@/lib/domains/taste/song-matching/types";
import type { RerankerService } from "@/lib/integrations/reranker/service";
import { log } from "@/lib/observability/logger";
import {
	type PlaylistForRanking,
	rankMatchSuggestionLists,
	type SongForRanking,
} from "@/lib/workflows/enrichment-pipeline/match-ranking";
import type { RankingRowPayload } from "../write-match-snapshot";

export interface MatchResultEntry {
	song_id: string;
	playlist_id: string;
	score: number;
	fused_score: number;
	rank: number | null;
	factors: Json;
	normalized_factors: Json;
	rankings?: RankingRowPayload[];
}

export type RankingOutcome =
	| { status: "superseded" }
	| {
			status: "completed";
			resultEntries: MatchResultEntry[];
			rerankDocumentMode: "analysis" | "metadata";
	  };

/**
 * Loads analysis text for stored-pair songs, reranks both orientations, and
 * builds the per-pair result rows (rankings + legacy score/rank mirror).
 *
 * `who` is used only for logging. `isSuperseded`, when provided, is checked
 * between orientations by rankMatchSuggestionLists — a superseded result
 * returns { status: "superseded" } and the caller must publish nothing.
 */
export async function runOrientedRanking(params: {
	who: string;
	storedPairs: MatchResult[];
	matchingSongs: SongForRanking[];
	playlists: PlaylistForRanking[];
	rerankerService: RerankerService;
	isSuperseded?: () => Promise<boolean>;
}): Promise<RankingOutcome> {
	const {
		who,
		storedPairs,
		matchingSongs,
		playlists,
		rerankerService,
		isSuperseded,
	} = params;

	let rerankDocumentMode: "analysis" | "metadata" = "metadata";
	const rankingsByPair = new Map<string, RankingRowPayload[]>();
	// Song-orientation rank keyed by "songId:playlistId" for legacy score/rank
	// mirror (C12): new read paths use match_result_ranking; old read paths use
	// the mirror value on match_result.score / match_result.rank.
	const songOrientationRankByPair = new Map<
		string,
		{ rank: number; orderingScore: number }
	>();

	if (storedPairs.length > 0) {
		// Load analyses for stored-pair songs — avoids fetching the full candidate
		// set when most songs have no pairs (empty-match case skips this entirely).
		const storedSongIdSet = new Set(storedPairs.map((p) => p.songId));
		const storedSongIds = [...storedSongIdSet];
		const analysesResult = await getSongAnalyses(storedSongIds);
		const analysisTextMap = new Map<string, string>();
		if (Result.isOk(analysesResult)) {
			for (const [songId, analysis] of analysesResult.value) {
				analysisTextMap.set(songId, flattenAnalysisText(analysis));
			}
		} else {
			log.error("match:analyses-degraded", {
				actor: who,
				error: analysesResult.error.message,
			});
		}
		rerankDocumentMode = analysisTextMap.size > 0 ? "analysis" : "metadata";

		const songsForRanking: SongForRanking[] = matchingSongs
			.filter((s) => storedSongIdSet.has(s.id))
			.map((s) => ({
				id: s.id,
				name: s.name,
				artists: s.artists,
				genres: s.genres,
				analysisText: analysisTextMap.get(s.id) ?? null,
			}));

		const rankResult = await rankMatchSuggestionLists({
			storedPairs,
			songs: songsForRanking,
			playlists,
			// If the provider is unavailable at call time, rankSongSuggestionLists
			// and rankPlaylistSuggestionLists degrade to fused_fallback internally.
			rerankerService,
			isSuperseded,
		});

		// A superseded result publishes nothing — a newer job will publish instead.
		if (rankResult.status === "superseded") {
			return { status: "superseded" };
		}

		// Build per-pair ranking payload from both orientations.
		for (const [orientation, lists] of rankResult.byOrientation) {
			for (const list of lists) {
				list.rankedPairs.forEach((pair, idx) => {
					const rank = idx + 1;
					const key = `${pair.songId}:${pair.playlistId}`;
					const row: RankingRowPayload = {
						orientation,
						rank,
						ordering_score: pair.orderingScore,
						reranker_score: pair.rerankerScore,
						source: pair.source,
						document_mode: pair.documentMode,
					};
					const existing = rankingsByPair.get(key) ?? [];
					existing.push(row);
					rankingsByPair.set(key, existing);

					if (orientation === "song") {
						songOrientationRankByPair.set(key, {
							rank,
							orderingScore: pair.orderingScore,
						});
					}
				});
			}
		}
	}

	const resultEntries: MatchResultEntry[] = storedPairs.map((pair) => {
		const key = `${pair.songId}:${pair.playlistId}`;
		const songOrientation = songOrientationRankByPair.get(key);
		return {
			song_id: pair.songId,
			playlist_id: pair.playlistId,
			// song-orientation ordering_score mirrors the legacy score column (C12);
			// falls back to fusedScore when no ranking row exists for this pair.
			score: songOrientation?.orderingScore ?? pair.fusedScore,
			fused_score: pair.fusedScore,
			// song-orientation rank mirrors the legacy rank column; null when absent.
			rank: songOrientation?.rank ?? null,
			factors: {
				embedding: pair.factors.embedding,
				audio: pair.factors.audio,
				genre: pair.factors.genre,
			},
			normalized_factors: {
				embedding: pair.normalizedFactors.embedding,
				audio: pair.normalizedFactors.audio,
				genre: pair.normalizedFactors.genre,
			},
			rankings: rankingsByPair.get(key),
		};
	});

	return { status: "completed", resultEntries, rerankDocumentMode };
}

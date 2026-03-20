/**
 * Shared reranking helper for match results.
 *
 * Used by both the normal enrichment pipeline and the rematch path
 * to ensure identical ranking behavior.
 */

import { Result } from "better-result";
import type {
	MatchingSong,
	MatchResult,
} from "@/lib/domains/taste/song-matching/types";
import type {
	MatchCandidate,
	RerankerService,
} from "@/lib/integrations/reranker/service";

interface PlaylistInfo {
	readonly id: string;
	readonly name: string;
	readonly description: string | null;
}

/**
 * Rerank match results per playlist using cross-encoder.
 * Mutates the matches map in place: updates scores, re-sorts, re-assigns ranks.
 */
export async function rerankMatches(
	matches: Map<string, MatchResult[]>,
	songs: MatchingSong[],
	playlists: PlaylistInfo[],
	rerankerService: RerankerService,
): Promise<void> {
	const songMap = new Map(songs.map((s) => [s.id, s]));
	const playlistMap = new Map(playlists.map((p) => [p.id, p]));

	// Group all matches by playlist for reranking
	const byPlaylist = new Map<
		string,
		{ songId: string; result: MatchResult }[]
	>();
	for (const [songId, results] of matches) {
		for (const r of results) {
			let group = byPlaylist.get(r.playlistId);
			if (!group) {
				group = [];
				byPlaylist.set(r.playlistId, group);
			}
			group.push({ songId, result: r });
		}
	}

	for (const [playlistId, entries] of byPlaylist) {
		const playlist = playlistMap.get(playlistId);
		if (!playlist) continue;
		const rankedEntries = [...entries].sort(
			(a, b) => b.result.score - a.result.score,
		);

		const query = [playlist.name, playlist.description]
			.filter(Boolean)
			.join(" — ");

		const candidates: MatchCandidate[] = rankedEntries.map((e) => {
			const song = songMap.get(e.songId);
			const genres = song?.genres?.join(", ") ?? "";
			const doc = `${song?.name ?? "Unknown"} by ${song?.artists?.join(", ") ?? "Unknown"}. Genres: ${genres}.`;
			return {
				id: e.songId,
				score: e.result.score,
				document: doc,
			};
		});

		const rerankResult = await rerankerService.rerank(query, candidates);
		if (Result.isError(rerankResult) || !rerankResult.value.reranked) continue;

		// Build a score lookup from reranked candidates
		const rerankedScores = new Map(
			rerankResult.value.candidates.map((c) => [c.id, c.score]),
		);

		// Update match results for each song with reranked scores
		for (const [songId, songResults] of matches) {
			const updated = songResults.map((r) => {
				if (r.playlistId !== playlistId) return r;
				const newScore = rerankedScores.get(songId);
				if (newScore === undefined) return r;
				return { ...r, score: newScore, rerankedScore: newScore };
			});

			// Re-sort by score and re-assign ranks
			updated.sort((a, b) => b.score - a.score);
			matches.set(
				songId,
				updated.map((r, i) => ({ ...r, rank: i + 1 })),
			);
		}
	}
}

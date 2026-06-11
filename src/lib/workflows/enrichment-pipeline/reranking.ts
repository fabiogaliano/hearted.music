/**
 * Shared reranking helper for match results.
 *
 * Used by both the normal enrichment pipeline and the rematch path
 * to ensure identical ranking behavior.
 *
 * Document mode is data-driven via the analysisText map:
 *   - Pass an empty map (or omit) → metadata-only document (name + artists + genres).
 *   - Pass a populated map → rich analysis document with analysis text appended.
 * There is no explicit mode enum; callers control the mode purely by populating the map.
 */

import { Result } from "better-result";
import { buildIntentText } from "@/lib/domains/taste/playlist-profiling/calculations";
import type {
	MatchingSong,
	MatchResult,
} from "@/lib/domains/taste/song-matching/types";
import type {
	MatchCandidate,
	RerankerService,
} from "@/lib/integrations/reranker/service";

/**
 * Maximum character budget for the analysis tail portion of a document.
 * ~400 tokens × 4 chars/token, leaving room for the metadata prefix and
 * the reranker template overhead (~100 token reserve).
 * Truncation always falls on a word boundary.
 */
const ANALYSIS_TAIL_MAX_CHARS = 1600;

interface PlaylistInfo {
	readonly id: string;
	readonly name: string;
	readonly description: string | null;
	/** Declared genre pills — when present, appended to the query as ". Genres: …"
	 *  so the reranker query stays byte-identical to the profiling intent text. */
	readonly genre_pills?: readonly string[] | null;
}

/**
 * Rerank match results per playlist using cross-encoder.
 * Mutates the matches map in place: updates scores, re-sorts, re-assigns ranks.
 *
 * @param analysisText - songId → flattened analysis prose. Pass an empty map
 *   for "metadata mode" (falls back to name+artists+genres one-liner). Pass a
 *   populated map for "analysis mode" (appends truncated analysis to each doc).
 *   The Phase 1 replay runner reuses this same function; it controls the mode
 *   purely by what it passes here — no enum parameter is needed.
 */
export async function rerankMatches(
	matches: Map<string, MatchResult[]>,
	songs: MatchingSong[],
	playlists: PlaylistInfo[],
	rerankerService: RerankerService,
	analysisText: Map<string, string> = new Map(),
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

	// Summary counters: the original DeepInfra contract bug stayed invisible
	// because every degradation path was silent. One summary line per call
	// makes "reranker never ran" impossible to miss in logs.
	let playlistsReranked = 0;
	let playlistsSkipped = 0;
	let docsReranked = 0;

	for (const [playlistId, entries] of byPlaylist) {
		const playlist = playlistMap.get(playlistId);
		if (!playlist) continue;
		const rankedEntries = entries.toSorted(
			(a, b) => b.result.score - a.result.score,
		);

		// buildIntentText produces the same string as the profiling embedding query,
		// keeping the reranker query byte-identical to what was embedded.
		const query =
			buildIntentText(
				playlist.name,
				playlist.description ?? undefined,
				playlist.genre_pills ?? [],
			) ?? playlist.name;

		const candidates: MatchCandidate[] = rankedEntries.map((e) => {
			const song = songMap.get(e.songId);
			const genres = song?.genres?.join(", ") ?? "";
			const metadataPrefix = `${song?.name ?? "Unknown"} by ${song?.artists?.join(", ") ?? "Unknown"}. Genres: ${genres}.`;

			const rawAnalysis = analysisText.get(e.songId);
			let doc: string;
			if (rawAnalysis) {
				// Truncate the analysis tail at a word boundary to keep the whole doc
				// within ~400 tokens. We never truncate the metadata prefix or query.
				let tail = rawAnalysis;
				if (tail.length > ANALYSIS_TAIL_MAX_CHARS) {
					const slice = tail.slice(0, ANALYSIS_TAIL_MAX_CHARS);
					const lastSpace = slice.lastIndexOf(" ");
					tail = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
				}
				doc = `${metadataPrefix}\n\n${tail}`;
			} else {
				doc = metadataPrefix;
			}

			return {
				id: e.songId,
				score: e.result.score,
				document: doc,
			};
		});

		const rerankResult = await rerankerService.rerank(query, candidates);
		if (Result.isError(rerankResult)) {
			console.warn(
				`[rerank] playlist ${playlistId}: rerank errored, keeping original order: ${rerankResult.error.message}`,
			);
			playlistsSkipped++;
			continue;
		}
		if (!rerankResult.value.reranked) {
			playlistsSkipped++;
			continue;
		}
		playlistsReranked++;
		docsReranked += rerankResult.value.rerankedCount;

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

			matches.set(
				songId,
				updated
					.toSorted((a, b) => b.score - a.score)
					.map((r, i) => ({ ...r, rank: i + 1 })),
			);
		}
	}

	console.log(
		`[rerank] reranked ${docsReranked} docs across ${playlistsReranked}/${byPlaylist.size} playlists` +
			(playlistsSkipped > 0 ? ` (${playlistsSkipped} skipped/degraded)` : ""),
	);
}

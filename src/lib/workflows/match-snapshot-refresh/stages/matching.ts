/**
 * Matching stage — scores candidate songs against target-playlist profiles
 * and retains the bidirectional top-N pairs (song-top-N ∪ playlist-top-N) for
 * storage. Oriented ranking (cross-encoder rerank per orientation) is a
 * separate stage — see ./ranking.ts — since retention must run first (only
 * retained pairs are reranked).
 */

import { Result } from "better-result";
import type { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import type { PlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import {
	MATCH_STORED_PAIRS_PER_PLAYLIST,
	MATCH_STORED_PAIRS_PER_SONG,
	retainStoredMatchPairs,
} from "@/lib/domains/taste/song-matching/retention";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import type {
	MatchingError,
	MatchingPlaylistProfile,
	MatchingSong,
	MatchResult,
} from "@/lib/domains/taste/song-matching/types";

export interface ScoringOutcome {
	matches: ReadonlyMap<
		string,
		ReadonlyArray<{ playlistId: string; score: number }>
	>;
	storedPairs: MatchResult[];
}

/**
 * Runs matchBatch and, on success, flattens + retains the pairs bound for
 * storage. Returns the raw matchBatch Result so the caller (orchestrator)
 * keeps ownership of stage-failure progress/error policy.
 */
export async function runScoring(
	embeddingService: EmbeddingService,
	profilingService: PlaylistProfilingService,
	matchingSongs: MatchingSong[],
	profiles: MatchingPlaylistProfile[],
	songEmbeddings: Map<string, number[]>,
	exclusionSet: Set<string> | undefined,
): Promise<Result<ScoringOutcome, MatchingError>> {
	const matchingService = createMatchingService(
		embeddingService,
		profilingService,
	);
	const matchResult = await matchingService.matchBatch(
		matchingSongs,
		profiles,
		songEmbeddings,
		exclusionSet !== undefined ? { exclusionSet } : undefined,
	);

	if (Result.isError(matchResult)) {
		return matchResult;
	}

	const allPairs: MatchResult[] = [];
	for (const results of matchResult.value.matches.values()) {
		allPairs.push(...results);
	}
	const storedPairs = retainStoredMatchPairs({
		thresholdedPairs: allPairs,
		perSongLimit: MATCH_STORED_PAIRS_PER_SONG,
		perPlaylistLimit: MATCH_STORED_PAIRS_PER_PLAYLIST,
	});

	return Result.ok({ matches: matchResult.value.matches, storedPairs });
}

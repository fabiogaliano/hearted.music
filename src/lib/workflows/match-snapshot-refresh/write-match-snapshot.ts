/**
 * Atomic snapshot publication — the ONLY path allowed to write
 * match_context + match_result for an account.
 *
 * Uses the publish_match_snapshot database function for transactional safety.
 */

import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json } from "@/lib/data/database.types";
import { MATCHING_ALGO_VERSION } from "@/lib/domains/enrichment/embeddings/versioning";
import { markItemsNew } from "@/lib/domains/library/liked-songs/status-queries";
import { computeMatchContextMetadata } from "@/lib/domains/taste/song-matching/cache";
import type {
	MatchingPlaylistProfile,
	MatchingSong,
} from "@/lib/domains/taste/song-matching/types";
import type { MatchSnapshotRefreshResult } from "./types";

interface MatchResultEntry {
	song_id: string;
	playlist_id: string;
	score: number;
	rank: number | null;
	factors: Json;
}

function toResultsJson(entries: MatchResultEntry[]): Json {
	return entries.map((entry) => ({
		song_id: entry.song_id,
		playlist_id: entry.playlist_id,
		score: entry.score,
		rank: entry.rank,
		factors: entry.factors,
	}));
}

/**
 * Publishes a full match snapshot atomically.
 * Returns a no-op result if the contextHash matches the latest published snapshot.
 */
export async function writeMatchSnapshot(opts: {
	accountId: string;
	songs: MatchingSong[];
	profiles: MatchingPlaylistProfile[];
	results: MatchResultEntry[];
	matchedSongIds: string[];
	exclusionSet?: Set<string>;
}): Promise<MatchSnapshotRefreshResult> {
	const { accountId, songs, profiles, results, matchedSongIds } = opts;

	// Compute context metadata for dedup
	const contextMeta = await computeMatchContextMetadata(
		songs,
		profiles,
		{},
		opts.exclusionSet,
	);

	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc("publish_match_snapshot", {
		p_account_id: accountId,
		p_algorithm_version: MATCHING_ALGO_VERSION,
		p_config_hash: contextMeta.configHash,
		p_playlist_set_hash: contextMeta.playlistSetHash,
		p_candidate_set_hash: contextMeta.candidateSetHash,
		p_context_hash: contextMeta.contextHash,
		p_playlist_count: profiles.length,
		p_song_count: songs.length,
		p_results: toResultsJson(results),
	});
	const contextId = data ?? null;

	if (error) {
		throw new Error(
			`[target-refresh] Snapshot publish failed: ${error.message}`,
		);
	}

	// NULL return means context_hash is already the latest published (no-op)
	if (!contextId) {
		return {
			published: false,
			contextId: null,
			matchedSongCount: 0,
			candidateCount: songs.length,
			playlistCount: profiles.length,
			isEmpty: false,
			noOp: true,
		};
	}

	// Mark matched songs as new
	if (matchedSongIds.length > 0) {
		await markItemsNew(accountId, "song", matchedSongIds);
	}

	return {
		published: true,
		contextId,
		matchedSongCount: matchedSongIds.length,
		candidateCount: songs.length,
		playlistCount: profiles.length,
		isEmpty: false,
		noOp: false,
	};
}

/**
 * Publishes an explicit empty snapshot when no target playlists remain.
 * Uses a stable empty context_hash so repeated zero-target refreshes no-op.
 */
export async function writeEmptySnapshot(
	accountId: string,
): Promise<MatchSnapshotRefreshResult> {
	const supabase = createAdminSupabaseClient();
	const emptyHash = "empty_target_playlist_snapshot";

	const { data, error } = await supabase.rpc("publish_match_snapshot", {
		p_account_id: accountId,
		p_algorithm_version: MATCHING_ALGO_VERSION,
		p_config_hash: "empty",
		p_playlist_set_hash: "empty",
		p_candidate_set_hash: "empty",
		p_context_hash: emptyHash,
		p_playlist_count: 0,
		p_song_count: 0,
		p_results: [],
	});
	const contextId = data ?? null;

	if (error) {
		throw new Error(
			`[target-refresh] Empty snapshot publish failed: ${error.message}`,
		);
	}

	if (!contextId) {
		return {
			published: false,
			contextId: null,
			matchedSongCount: 0,
			candidateCount: 0,
			playlistCount: 0,
			isEmpty: true,
			noOp: true,
		};
	}

	return {
		published: true,
		contextId,
		matchedSongCount: 0,
		candidateCount: 0,
		playlistCount: 0,
		isEmpty: true,
		noOp: false,
	};
}

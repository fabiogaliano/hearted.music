/**
 * Atomic snapshot publication — the ONLY path allowed to write
 * match_snapshot + match_result for an account.
 *
 * Uses the publish_match_snapshot database function for transactional safety.
 */

import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json } from "@/lib/data/database.types";
import { MATCHING_ALGO_VERSION } from "@/lib/domains/enrichment/embeddings/versioning";
import { markItemsNew } from "@/lib/domains/library/liked-songs/status-queries";
import { computeMatchSnapshotMetadata } from "@/lib/domains/taste/song-matching/cache";
import type {
	MatchingPlaylistProfile,
	MatchingSong,
} from "@/lib/domains/taste/song-matching/types";
import type { MatchSnapshotRefreshResult } from "./types";

/**
 * One ranking row destined for match_result_ranking, nested inside a result
 * item in the p_results payload sent to publish_match_snapshot (D1/D2).
 *
 * The index signature [key: string]: Json makes the type directly assignable
 * to the Json type required by the publish_match_snapshot RPC parameter.
 * Each explicit field's type is a subset of Json (string, number, null).
 */
export interface RankingRowPayload {
	orientation: string;
	rank: number;
	ordering_score: number;
	reranker_score: number | null;
	source: string;
	document_mode: string;
	[key: string]: Json;
}

interface MatchResultEntry {
	song_id: string;
	playlist_id: string;
	score: number;
	fused_score: number;
	rank: number | null;
	factors: Json;
	normalized_factors: Json;
	/** Oriented ranking rows for this pair; omitted for legacy callers (D1). */
	rankings?: RankingRowPayload[];
}

function toResultsJson(entries: MatchResultEntry[]): Json {
	return entries.map((entry) => ({
		song_id: entry.song_id,
		playlist_id: entry.playlist_id,
		score: entry.score,
		fused_score: entry.fused_score,
		rank: entry.rank,
		factors: entry.factors,
		normalized_factors: entry.normalized_factors,
		...(entry.rankings !== undefined ? { rankings: entry.rankings } : {}),
	}));
}

/**
 * Publishes a full match snapshot atomically.
 * Returns a no-op result if the snapshotHash matches the latest published snapshot.
 */
export async function writeMatchSnapshot(opts: {
	accountId: string;
	songs: MatchingSong[];
	profiles: MatchingPlaylistProfile[];
	results: MatchResultEntry[];
	matchedSongIds: string[];
	exclusionSet?: Set<string>;
	/** Document mode actually used for reranking (defaults to "metadata" — no rerank ran) */
	rerankDocumentMode?: "analysis" | "metadata";
}): Promise<MatchSnapshotRefreshResult> {
	const { accountId, songs, profiles, results, matchedSongIds } = opts;

	// Compute context metadata for dedup
	const snapshotMeta = await computeMatchSnapshotMetadata(
		songs,
		profiles,
		{},
		opts.exclusionSet,
		opts.rerankDocumentMode ?? "metadata",
	);

	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc("publish_match_snapshot", {
		p_account_id: accountId,
		p_algorithm_version: MATCHING_ALGO_VERSION,
		p_config_hash: snapshotMeta.configHash,
		p_playlist_set_hash: snapshotMeta.playlistSetHash,
		p_candidate_set_hash: snapshotMeta.candidateSetHash,
		p_snapshot_hash: snapshotMeta.snapshotHash,
		p_playlist_count: profiles.length,
		p_song_count: songs.length,
		p_results: toResultsJson(results),
	});
	const snapshotId = data ?? null;

	if (error) {
		throw new Error(
			`[target-refresh] Snapshot publish failed: ${error.message}`,
		);
	}

	// NULL return means snapshot_hash is already the latest published (no-op)
	if (!snapshotId) {
		return {
			published: false,
			snapshotId: null,
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
		snapshotId,
		matchedSongCount: matchedSongIds.length,
		candidateCount: songs.length,
		playlistCount: profiles.length,
		isEmpty: false,
		noOp: false,
	};
}

/**
 * Publishes an explicit empty snapshot when no target playlists remain.
 * Uses a stable empty snapshot_hash so repeated zero-target refreshes no-op.
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
		p_snapshot_hash: emptyHash,
		p_playlist_count: 0,
		p_song_count: 0,
		p_results: [],
	});
	const snapshotId = data ?? null;

	if (error) {
		throw new Error(
			`[target-refresh] Empty snapshot publish failed: ${error.message}`,
		);
	}

	if (!snapshotId) {
		return {
			published: false,
			snapshotId: null,
			matchedSongCount: 0,
			candidateCount: 0,
			playlistCount: 0,
			isEmpty: true,
			noOp: true,
		};
	}

	return {
		published: true,
		snapshotId,
		matchedSongCount: 0,
		candidateCount: 0,
		playlistCount: 0,
		isEmpty: true,
		noOp: false,
	};
}

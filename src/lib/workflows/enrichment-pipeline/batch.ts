import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import * as songData from "@/lib/domains/library/songs/queries";
import type { Song } from "@/lib/domains/library/songs/queries";

export interface PipelineBatch {
	readonly songIds: string[];
	readonly songs: Song[];
	readonly spotifyIdBySongId: Map<string, string>;
}

/**
 * Selects the next batch of liked songs needing full pipeline processing
 * via the DB-side selector RPC. Replaces the old app-side exclusion-list approach.
 */
export async function selectPipelineBatch(
	accountId: string,
	maxSongs: number,
): Promise<PipelineBatch> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"select_liked_song_ids_needing_pipeline_processing",
		{ p_account_id: accountId, p_limit: maxSongs },
	);

	if (error) {
		throw new Error(`Failed to select pipeline batch: ${error.message}`);
	}

	const songIds = (data ?? []).map((row: { song_id: string }) => row.song_id);

	if (songIds.length === 0) {
		return { songIds: [], songs: [], spotifyIdBySongId: new Map() };
	}

	return loadBatchSongs(songIds);
}

/**
 * Returns liked song IDs that have all 4 shared data artifacts.
 * Used by match snapshot refresh for candidate loading.
 */
export async function getDataEnrichedSongIds(
	accountId: string,
): Promise<string[]> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"select_data_enriched_liked_song_ids",
		{ p_account_id: accountId },
	);

	if (error) {
		throw new Error(`Failed to select data-enriched songs: ${error.message}`);
	}

	return (data ?? []).map((row: { song_id: string }) => row.song_id);
}

/**
 * Probes whether more songs still need pipeline processing.
 * Used to determine requestSatisfied after a chunk completes.
 */
export async function hasMoreSongsNeedingProcessing(
	accountId: string,
): Promise<boolean> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"select_liked_song_ids_needing_pipeline_processing",
		{ p_account_id: accountId, p_limit: 1 },
	);

	if (error) return false;
	return (data ?? []).length > 0;
}

async function loadBatchSongs(songIds: string[]): Promise<PipelineBatch> {
	const songsResult = await songData.getByIds(songIds);
	if (Result.isError(songsResult)) {
		throw new Error(`Failed to load batch songs: ${songsResult.error.message}`);
	}

	const spotifyIdBySongId = new Map<string, string>();
	const validSongIds: string[] = [];

	for (const song of songsResult.value) {
		if (song.spotify_id) {
			validSongIds.push(song.id);
			spotifyIdBySongId.set(song.id, song.spotify_id);
		}
	}

	return {
		songIds: validSongIds,
		songs: songsResult.value,
		spotifyIdBySongId,
	};
}

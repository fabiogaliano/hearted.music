import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	type Song,
	getByIds as getSongsByIds,
} from "@/lib/domains/library/songs/queries";
import type { EnrichmentWorkPlan, SongStageFlags } from "./types";

export interface PipelineBatch {
	readonly songIds: string[];
	readonly songs: Song[];
	readonly spotifyIdBySongId: Map<string, string>;
}

/**
 * Returns liked song IDs that are entitled and ready for matching candidacy.
 * Readiness requires genres, song_analysis, and song_embedding;
 * song_audio_feature is optional (the matching engine adapts when it is missing).
 * Used by match snapshot refresh for billing-aware candidate loading.
 * Revoked and locked songs are excluded.
 */
export async function getEntitledDataEnrichedSongIds(
	accountId: string,
): Promise<string[]> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"select_entitled_data_enriched_liked_song_ids",
		{ p_account_id: accountId },
	);

	if (error) {
		throw new Error(
			`Failed to select entitled data-enriched songs: ${error.message}`,
		);
	}

	return (data ?? []).map((row: { song_id: string }) => row.song_id);
}

/**
 * Selects the next batch using the billing-aware selector RPC.
 * Returns a typed work plan with per-song stage flags and pre-partitioned sub-batches.
 *
 * All stage flags (audio_features, genre_tagging, analysis, embedding,
 * content_activation) are entitlement-gated. Optional Phase A signals with a
 * recorded source_not_found marker are masked off so they aren't retried.
 */
export async function selectEnrichmentWorkPlan(
	accountId: string,
	maxSongs: number,
): Promise<EnrichmentWorkPlan> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"select_liked_song_ids_needing_enrichment_work",
		{ p_account_id: accountId, p_limit: maxSongs },
	);

	if (error) {
		throw new Error(`Failed to select enrichment work plan: ${error.message}`);
	}

	const rows = data ?? [];

	const flags: SongStageFlags[] = rows.map((row) => ({
		songId: row.song_id,
		needsAudioFeatures: row.needs_audio_features,
		needsGenreTagging: row.needs_genre_tagging,
		needsAnalysis: row.needs_analysis,
		needsEmbedding: row.needs_embedding,
		needsContentActivation: row.needs_content_activation,
	}));

	return {
		allSongIds: flags.map((f) => f.songId),
		flags,
		needAudioFeatures: flags
			.filter((f) => f.needsAudioFeatures)
			.map((f) => f.songId),
		needGenreTagging: flags
			.filter((f) => f.needsGenreTagging)
			.map((f) => f.songId),
		needAnalysis: flags.filter((f) => f.needsAnalysis).map((f) => f.songId),
		needEmbedding: flags.filter((f) => f.needsEmbedding).map((f) => f.songId),
		needContentActivation: flags
			.filter((f) => f.needsContentActivation)
			.map((f) => f.songId),
	};
}

/**
 * Probes whether more songs still need enrichment work (billing-aware).
 * Used to determine requestSatisfied after a chunk completes.
 */
export async function hasMoreSongsNeedingEnrichmentWork(
	accountId: string,
): Promise<boolean> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"select_liked_song_ids_needing_enrichment_work",
		{ p_account_id: accountId, p_limit: 1 },
	);

	if (error) {
		throw new Error(
			`Failed to probe songs needing enrichment work: ${error.message}`,
		);
	}

	return (data ?? []).length > 0;
}

export async function loadBatchSongs(
	songIds: string[],
): Promise<PipelineBatch> {
	const songsResult = await getSongsByIds(songIds);
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

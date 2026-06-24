import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	getByIds as getSongsByIds,
	type Song,
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
 * Selects the next batch using two RPCs and merges their results.
 *
 * Phase-1 (audio_features, genre_tagging) uses a separate, ungated selector
 * that runs for every actively-liked song. Phase-2/3 (song_analysis,
 * song_embedding, content_activation) continue to use the entitlement-gated
 * selector so those expensive ML/AI stages only run for entitled songs.
 *
 * The merge is additive: a song that needs Phase-1 work but is not entitled
 * appears in needAudioFeatures/needGenreTagging only. A song that has Phase-1
 * data and is entitled may appear in needAnalysis/needEmbedding/needContentActivation
 * only. A song that needs both shows up in both sub-batches.
 */
export async function selectEnrichmentWorkPlan(
	accountId: string,
	maxSongs: number,
): Promise<EnrichmentWorkPlan> {
	const supabase = createAdminSupabaseClient();

	// Run both selectors in parallel; Phase-1 is ungated, Phase-2/3 is gated.
	const [phase1Result, phase23Result] = await Promise.all([
		supabase.rpc("select_phase1_song_ids_needing_enrichment_work", {
			p_account_id: accountId,
			p_limit: maxSongs,
		}),
		supabase.rpc("select_liked_song_ids_needing_enrichment_work", {
			p_account_id: accountId,
			p_limit: maxSongs,
		}),
	]);

	if (phase1Result.error) {
		throw new Error(
			`Failed to select Phase-1 enrichment work plan: ${phase1Result.error.message}`,
		);
	}
	if (phase23Result.error) {
		throw new Error(
			`Failed to select enrichment work plan: ${phase23Result.error.message}`,
		);
	}

	const phase1Rows = phase1Result.data ?? [];
	const phase23Rows = phase23Result.data ?? [];

	// Build per-song flag maps from each selector's results.
	const audioFeaturesNeeded = new Set(
		phase1Rows.filter((r) => r.needs_audio_features).map((r) => r.song_id),
	);
	const genreTaggingNeeded = new Set(
		phase1Rows.filter((r) => r.needs_genre_tagging).map((r) => r.song_id),
	);

	const analysisNeeded = new Set(
		phase23Rows.filter((r) => r.needs_analysis).map((r) => r.song_id),
	);
	const embeddingNeeded = new Set(
		phase23Rows.filter((r) => r.needs_embedding).map((r) => r.song_id),
	);
	const contentActivationNeeded = new Set(
		phase23Rows.filter((r) => r.needs_content_activation).map((r) => r.song_id),
	);

	// Union all song IDs across both selectors; preserve Phase-1 order first.
	const allIds = new Set<string>();
	for (const r of phase1Rows) allIds.add(r.song_id);
	for (const r of phase23Rows) allIds.add(r.song_id);
	const allSongIds = [...allIds];

	const flags: SongStageFlags[] = allSongIds.map((songId) => ({
		songId,
		needsAudioFeatures: audioFeaturesNeeded.has(songId),
		needsGenreTagging: genreTaggingNeeded.has(songId),
		needsAnalysis: analysisNeeded.has(songId),
		needsEmbedding: embeddingNeeded.has(songId),
		needsContentActivation: contentActivationNeeded.has(songId),
	}));

	return {
		allSongIds,
		flags,
		needAudioFeatures: [...audioFeaturesNeeded],
		needGenreTagging: [...genreTaggingNeeded],
		needAnalysis: [...analysisNeeded],
		needEmbedding: [...embeddingNeeded],
		needContentActivation: [...contentActivationNeeded],
	};
}

/**
 * Probes whether more songs still need enrichment work (Phase-1 or Phase-2/3).
 * Used to determine requestSatisfied after a chunk completes.
 *
 * Checks the ungated Phase-1 selector first (cheap, covers all songs), then
 * falls back to the entitlement-gated selector so that entitled songs with
 * pending analysis/embedding/activation are also detected.
 */
export async function hasMoreSongsNeedingEnrichmentWork(
	accountId: string,
): Promise<boolean> {
	const supabase = createAdminSupabaseClient();

	const [phase1Result, phase23Result] = await Promise.all([
		supabase.rpc("select_phase1_song_ids_needing_enrichment_work", {
			p_account_id: accountId,
			p_limit: 1,
		}),
		supabase.rpc("select_liked_song_ids_needing_enrichment_work", {
			p_account_id: accountId,
			p_limit: 1,
		}),
	]);

	if (phase1Result.error) {
		throw new Error(
			`Failed to probe songs needing enrichment work: ${phase1Result.error.message}`,
		);
	}
	if (phase23Result.error) {
		throw new Error(
			`Failed to probe songs needing enrichment work: ${phase23Result.error.message}`,
		);
	}

	return (
		(phase1Result.data ?? []).length > 0 ||
		(phase23Result.data ?? []).length > 0
	);
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

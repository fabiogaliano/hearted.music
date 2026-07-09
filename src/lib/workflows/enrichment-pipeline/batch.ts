import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Database } from "@/lib/data/database.types";
import {
	getByIds as getSongsByIds,
	type Song,
} from "@/lib/domains/library/songs/queries";
import type { EnrichmentSelectionMode } from "@/lib/platform/jobs/progress/enrichment";
import type { EnrichmentWorkPlan, SongStageFlags } from "./types";

type Phase1SelectorRow =
	Database["public"]["Functions"]["select_phase1_song_ids_needing_enrichment_work"]["Returns"][number];
type GatedSelectorRow =
	Database["public"]["Functions"]["select_liked_song_ids_needing_enrichment_work"]["Returns"][number];

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
	songIds?: string[],
): Promise<string[]> {
	const supabase = createAdminSupabaseClient();

	// songIds scopes the entitlement check to a specific batch server-side so the
	// RPC returns at most that batch instead of the account's full entitled set.
	// Omitted (full set) by the match-snapshot and waitlist candidate-loading
	// callers; passed by the per-batch new-candidate probe in the orchestrator.
	const { data, error } = await supabase.rpc(
		"select_entitled_data_enriched_liked_song_ids",
		songIds
			? { p_account_id: accountId, p_song_ids: songIds }
			: { p_account_id: accountId },
	);

	if (error) {
		throw new Error(
			`Failed to select entitled data-enriched songs: ${error.message}`,
		);
	}

	return (data ?? []).map((row: { song_id: string }) => row.song_id);
}

/**
 * Selects the next batch by unioning two selector RPCs and merging their flags.
 * Returns a typed work plan with per-song stage flags and pre-partitioned sub-batches.
 *
 * Phase-1 (audio_features, genre_tagging) comes from an ungated selector that
 * runs for every actively-liked song, so free users get the deterministic
 * signals the playlist-creation preview engine needs across their whole library.
 * Phase-2/3 (song_analysis, song_embedding, content_activation) come from the
 * entitlement-gated selector so those expensive ML/AI stages stay restricted to
 * entitled songs. `mode` only swaps which gated selector is used:
 * first_match_bootstrap orders by readiness_rank (fewest stages remaining first)
 * before liked_at to front-load near-ready songs; both gated RPCs share the
 * normal selector's signature and return shape, so the cast below is accurate.
 *
 * The merge is additive and idempotent for entitled users: the ungated Phase-1
 * selector returns the same audio_features/genre_tagging candidates the gated
 * one would (it is a superset minus the is_entitled conjunct), so taking those
 * two flags from Phase-1 only never drops or double-counts an entitled song.
 */
export async function selectEnrichmentWorkPlan(
	accountId: string,
	maxSongs: number,
	mode: EnrichmentSelectionMode,
): Promise<EnrichmentWorkPlan> {
	const supabase = createAdminSupabaseClient();

	// The bootstrap RPC shares the normal selector's signature and return shape;
	// cast the union down to the normal name to satisfy the rpc() overload.
	const gatedRpcName = (
		mode === "first_match_bootstrap"
			? "select_liked_song_ids_needing_first_match_enrichment_work"
			: "select_liked_song_ids_needing_enrichment_work"
	) as "select_liked_song_ids_needing_enrichment_work";

	// Gated selector is issued second so a name-tracking mock sees it last; its
	// error is checked first so the thrown message matches the pre-merge contract.
	const [phase1Result, gatedResult] = await Promise.all([
		supabase.rpc("select_phase1_song_ids_needing_enrichment_work", {
			p_account_id: accountId,
			p_limit: maxSongs,
		}),
		supabase.rpc(gatedRpcName, {
			p_account_id: accountId,
			p_limit: maxSongs,
		}),
	]);

	if (gatedResult.error) {
		throw new Error(
			`Failed to select enrichment work plan: ${gatedResult.error.message}`,
		);
	}
	if (phase1Result.error) {
		throw new Error(
			`Failed to select Phase-1 enrichment work plan: ${phase1Result.error.message}`,
		);
	}

	// Explicit row types: the two selectors have different return shapes, so
	// Promise.all's tuple inference widens the destructured results to any.
	const phase1Rows: Phase1SelectorRow[] = phase1Result.data ?? [];
	const gatedRows: GatedSelectorRow[] = gatedResult.data ?? [];

	// Phase-1 flags: ungated selector only.
	const audioFeaturesNeeded = new Set(
		phase1Rows.filter((r) => r.needs_audio_features).map((r) => r.song_id),
	);
	const genreTaggingNeeded = new Set(
		phase1Rows.filter((r) => r.needs_genre_tagging).map((r) => r.song_id),
	);

	// Phase-2/3 flags: entitlement-gated selector only.
	const analysisNeeded = new Set(
		gatedRows.filter((r) => r.needs_analysis).map((r) => r.song_id),
	);
	const embeddingNeeded = new Set(
		gatedRows.filter((r) => r.needs_embedding).map((r) => r.song_id),
	);
	const contentActivationNeeded = new Set(
		gatedRows.filter((r) => r.needs_content_activation).map((r) => r.song_id),
	);

	// Union all song IDs across both selectors; Phase-1 order first.
	const allIds = new Set<string>();
	for (const r of phase1Rows) allIds.add(r.song_id);
	for (const r of gatedRows) allIds.add(r.song_id);
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
 * Checks the ungated Phase-1 selector alongside the entitlement-gated one so a
 * free account with pending audio_features/genre_tagging still reports work —
 * otherwise the reconciler would mark enrichment satisfied and never drain the
 * Phase-1 backlog the playlist preview depends on.
 */
export async function hasMoreSongsNeedingEnrichmentWork(
	accountId: string,
): Promise<boolean> {
	const supabase = createAdminSupabaseClient();

	const [phase1Result, gatedResult] = await Promise.all([
		supabase.rpc("select_phase1_song_ids_needing_enrichment_work", {
			p_account_id: accountId,
			p_limit: 1,
		}),
		supabase.rpc("select_liked_song_ids_needing_enrichment_work", {
			p_account_id: accountId,
			p_limit: 1,
		}),
	]);

	if (gatedResult.error) {
		throw new Error(
			`Failed to probe songs needing enrichment work: ${gatedResult.error.message}`,
		);
	}
	if (phase1Result.error) {
		throw new Error(
			`Failed to probe songs needing enrichment work: ${phase1Result.error.message}`,
		);
	}

	return (
		(phase1Result.data ?? []).length > 0 || (gatedResult.data ?? []).length > 0
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

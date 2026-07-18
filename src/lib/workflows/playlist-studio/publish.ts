/**
 * Workflow: draft→Spotify publish path (the write half of the studio session).
 *
 * runPersistNewPlaylistConfig persists match config onto a newly-created
 * playlist and returns the ordered track URIs for the bulk-add step.
 * runRecordPlaylistMatchDecisions bulk-writes match_decision "added" rows for
 * the songs committed to the new playlist so they don't resurface as
 * suggestions. These are two separate entry points with their own ownership
 * re-check each (defense in depth) — do not factor the check into a shared
 * helper; see the comment on each function.
 */

import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { readBillingStateOrFreeTier } from "@/lib/domains/billing/queries";
import { selectOwnedSongIds } from "@/lib/domains/library/liked-songs/queries";
import {
	getPlaylistBySpotifyId,
	updatePlaylistMatchConfig,
} from "@/lib/domains/library/playlists/queries";
import { getByIds as getSongsByIds } from "@/lib/domains/library/songs/queries";
import { isIntentEligible } from "@/lib/domains/playlists/intent-eligibility";
import { normalizeMatchFilters } from "@/lib/domains/taste/match-filters/normalizers";
import { parseSaveMatchFilters } from "@/lib/domains/taste/match-filters/schemas";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { upsertMatchDecisions } from "@/lib/domains/taste/song-matching/decision-queries";
import { sanitizeGenrePills } from "@/lib/integrations/lastfm/whitelist";

export interface PersistNewPlaylistConfigInput {
	/**
	 * Spotify playlist ID (not URI) — extracted from the URI returned by
	 * createPlaylistAcknowledged before calling this function.
	 */
	spotifyId: string;
	/** Ordered song UUIDs from the previewed draft. */
	songIds: string[];
	/** Natural-language intent phrase (premium). */
	intent: string | null;
	/** Genre pills from the draft config. */
	genrePills: string[];
	/** Match filters from the draft config. */
	matchFilters: PlaylistMatchFiltersV1;
	/** Whether the client reports intent was applied in the preview. */
	intentApplied: boolean;
}

export interface PersistNewPlaylistConfigResult {
	/** Ordered Spotify track URIs for the bulk-add step, in the same order as songIds. */
	trackUris: string[];
	/**
	 * Internal DB playlist id (the `playlist` table's UUID primary key, distinct
	 * from spotifyId). The publish result needs this to link into the
	 * managed-playlist detail route (/playlists/$playlistRef), which resolves
	 * against this id, never the Spotify id.
	 */
	playlistId: string;
}

/**
 * Persists the draft config onto a newly-created playlist row and resolves
 * the ordered track URIs so the caller can bulk-add them to Spotify.
 *
 * Responsibilities:
 * - Re-checks intent eligibility server-side (never trusts intentApplied from client).
 * - Writes match_intent / genre_pills / match_filters to the playlist row via
 *   updatePlaylistMatchConfig (the same write path used by the managed-playlist editor).
 * - Returns the ordered Spotify track URIs so the orchestrator can bulk-add them
 *   in one addToPlaylist call (no extra round-trip needed).
 *
 * Ownership check: verifies the playlist belongs to this account before writing
 * (the service-role client bypasses RLS).
 */
export async function runPersistNewPlaylistConfig(
	supabase: AdminSupabaseClient,
	accountId: string,
	data: PersistNewPlaylistConfigInput,
): Promise<PersistNewPlaylistConfigResult> {
	// Verify the playlist belongs to this account (service-role bypasses RLS).
	const playlistResult = await getPlaylistBySpotifyId(
		accountId,
		data.spotifyId,
	);
	if (Result.isError(playlistResult)) {
		throw new Error("Failed to look up playlist");
	}
	if (
		playlistResult.value === null ||
		playlistResult.value.account_id !== accountId
	) {
		throw new Error("Playlist not found");
	}
	const playlistId = playlistResult.value.id;

	// Server-side intent eligibility re-check: billing state resolved in
	// parallel with the song lookup and the ownership guard to avoid serial
	// waits. ownedResult constrains data.songIds to the account's active
	// liked_song rows — getSongsByIds hits the global song table via the
	// service-role client, so without this a tampered request could resolve
	// URIs for songs the account never liked.
	const [billingState, songsResult, ownedResult] = await Promise.all([
		readBillingStateOrFreeTier(
			supabase,
			accountId,
			"persist_new_playlist_config",
		),
		getSongsByIds(data.songIds),
		selectOwnedSongIds(accountId, data.songIds),
	]);

	// intent is only persisted when the server independently confirms eligibility
	// AND the client-reported intentApplied flag is true. The client flag gates
	// intent writes only when the feature was actually used in the preview —
	// eligibility alone doesn't mean intent should be saved (e.g. user cleared
	// the field before creating).
	const eligible = isIntentEligible(billingState);
	const trimmedIntent = data.intent?.trim() ?? "";
	const effectiveIntent =
		eligible && data.intentApplied && trimmedIntent.length > 0
			? trimmedIntent
			: null;

	const genrePills = sanitizeGenrePills(data.genrePills);

	const filtersParseResult = parseSaveMatchFilters(data.matchFilters);
	if (Result.isError(filtersParseResult)) {
		throw new Error(`Invalid match filters: ${filtersParseResult.error}`);
	}
	const matchFilters = normalizeMatchFilters(filtersParseResult.value);

	const updateResult = await updatePlaylistMatchConfig(accountId, playlistId, {
		matchIntent: effectiveIntent,
		genrePills,
		matchFilters,
	});
	if (Result.isError(updateResult)) {
		throw new Error(
			`Failed to persist playlist config: ${updateResult.error.message}`,
		);
	}

	// Build the ordered track URI list from the song rows.
	// Songs not found in the DB (e.g. deleted) are silently dropped — the
	// playlist was created with whatever exists. Preserve the caller's ordering.
	if (Result.isError(songsResult)) {
		// Non-fatal: track URIs can't be resolved. Return empty so the
		// orchestrator skips the add step rather than failing the whole commit.
		console.error(
			"[persistNewPlaylistConfig] song lookup failed:",
			songsResult.error,
		);
		return { trackUris: [], playlistId };
	}

	// Fail closed if ownership can't be verified: without a trusted owned-set
	// we can't safely resolve URIs, so skip the add step rather than trust the
	// caller-supplied id list.
	if (Result.isError(ownedResult)) {
		console.error(
			"[persistNewPlaylistConfig] ownership lookup failed:",
			ownedResult.error,
		);
		return { trackUris: [], playlistId };
	}
	const ownedIds = ownedResult.value;

	const songById = new Map(songsResult.value.map((s) => [s.id, s]));
	const trackUris: string[] = [];
	for (const id of data.songIds) {
		// Skip any id the account doesn't actively like — never resolve URIs
		// for songs outside the caller's own liked library.
		if (!ownedIds.has(id)) continue;
		const song = songById.get(id);
		if (song?.spotify_id) {
			trackUris.push(`spotify:track:${song.spotify_id}`);
		}
	}

	return { trackUris, playlistId };
}

export interface RecordPlaylistMatchDecisionsInput {
	/**
	 * Spotify playlist ID — used to look up the internal playlist UUID.
	 */
	spotifyId: string;
	/** Song UUIDs to record "added" decisions for. */
	songIds: string[];
}

/**
 * Writes match_decision "added" rows for (song, playlist) pairs so those songs
 * don't resurface as suggestions for the new playlist.
 *
 * Uses upsertMatchDecisions (batch path) — no snapshot linkage since the draft
 * was assembled outside the match snapshot system. snapshotId and servedRank are
 * intentionally null: these are implicit positives from the creation flow, not
 * surfaced suggestions the user acted on.
 *
 * Non-fatal from the orchestrator's perspective — a failure here doesn't undo
 * the created playlist or its tracks.
 */
export async function runRecordPlaylistMatchDecisions(
	accountId: string,
	data: RecordPlaylistMatchDecisionsInput,
): Promise<{ recorded: number }> {
	if (data.songIds.length === 0) return { recorded: 0 };

	// Look up the internal playlist UUID (match_decision FK references
	// playlist.id) and verify song ownership in parallel. Ownership must be
	// re-checked here: this is a separate entry point from
	// persistNewPlaylistConfig, so it can't rely on that function's guard.
	const [playlistResult, ownedResult] = await Promise.all([
		getPlaylistBySpotifyId(accountId, data.spotifyId),
		selectOwnedSongIds(accountId, data.songIds),
	]);
	if (Result.isError(playlistResult) || playlistResult.value === null) {
		throw new Error("Playlist not found for match decision recording");
	}
	if (Result.isError(ownedResult)) {
		throw new Error(
			"Failed to verify song ownership for match decision recording",
		);
	}
	const playlistId = playlistResult.value.id;

	// Record decisions only for songs the account actually likes — never write
	// match_decision rows for arbitrary catalog UUIDs.
	const ownedSongIds = data.songIds.filter((id) => ownedResult.value.has(id));
	if (ownedSongIds.length === 0) return { recorded: 0 };

	const decisions = ownedSongIds.map((songId) => ({
		accountId,
		songId,
		playlistId,
		decision: "added" as const,
		snapshotId: null,
		servedRank: null,
	}));

	const result = await upsertMatchDecisions(decisions);
	if (Result.isError(result)) {
		throw new Error(
			`Failed to record match decisions: ${result.error.message}`,
		);
	}

	return { recorded: result.value.length };
}

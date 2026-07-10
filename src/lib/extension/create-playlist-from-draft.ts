/**
 * Client-side orchestrator for committing a playlist draft to Spotify.
 *
 * Called by T7's create UI. Owns the full DRAFT→SPOTIFY sequence:
 *   1. extension reachability + Spotify connection check
 *   2. userId resolution from the server (cached on the account)
 *   3. createPlaylistAcknowledged → new playlist uri + DB row
 *   4. persist match config server-side (re-checks intent eligibility)
 *      and resolve ordered track URIs for the bulk-add step
 *   5. bulk addToPlaylist for the previewed tracks (single command)
 *   6. bulk match_decision "added" rows (non-fatal, fire-and-forget)
 *
 * The dual write (Spotify then DB) is non-atomic and un-eliminable: only the
 * client extension can talk to Spotify. If the Spotify create succeeds but the
 * DB acknowledge write fails even after bounded retries, step 3 returns a
 * "created-unsynced" result and the flow stops BEFORE step 4 — the ownership
 * guard in persistNewPlaylistConfig requires the row to exist. The caller then
 * resumes via resumePlaylistCreateFromDraft, which re-drives the acknowledge and
 * steps 4–6 against the EXISTING playlist (never a fresh create).
 *
 * The draft state (songIds, config) is never mutated here — callers are
 * responsible for preserving it on any failure branch so the user can retry.
 */

import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import {
	persistNewPlaylistConfig,
	recordPlaylistMatchDecisions,
	resolveSpotifyUserId,
} from "@/lib/server/playlist-draft.functions";
import { getSpotifyConnectionStatus, isExtensionInstalled } from "./detect";
import {
	acknowledgeCreateWithRetry,
	createPlaylistAcknowledged,
} from "./playlist-write-acknowledgement";
import {
	outcomeFromAcknowledgedResult,
	outcomeFromCommandResponse,
} from "./spotify-action-outcome";
import { addToPlaylist } from "./spotify-client";

export interface CreatePlaylistFromDraftInput {
	/** Display name for the new playlist. */
	name: string;
	/**
	 * Ordered song UUIDs from the previewed draft.
	 * The server resolves spotify_id from these — must match rows owned by this account.
	 */
	songIds: string[];
	/** Genre pills from the draft config. */
	genrePills: string[];
	/** Hard match filters from the draft config. */
	matchFilters: PlaylistMatchFiltersV1;
	/**
	 * Whether the preview engine reported that intent was applied.
	 * The server re-checks eligibility before persisting match_intent — this
	 * flag gates whether intent is written at all, not whether the account qualifies.
	 */
	intentApplied: boolean;
	/**
	 * The intent phrase from the draft config.
	 * Only persisted server-side if eligibility check passes and intentApplied is true.
	 */
	intent: string | null;
}

export type CreatePlaylistFromDraftResult =
	| {
			status: "success";
			playlistUri: string;
			/** Spotify playlist ID extracted from the URI. */
			spotifyId: string;
	  }
	| { status: "reconnect-required" }
	| { status: "extension-unavailable" }
	| {
			/**
			 * The playlist exists on Spotify but the DB acknowledge write never landed
			 * (even after bounded retries), so there is no local playlist row yet.
			 * The flow stopped BEFORE persistNewPlaylistConfig — no config or tracks
			 * were persisted. Callers must offer a retry that resumes from the
			 * acknowledge/config steps using this playlistUri/spotifyId, never a fresh
			 * create (which would produce a duplicate Spotify playlist).
			 */
			status: "created-unsynced";
			playlistUri: string;
			spotifyId: string;
	  }
	| {
			status: "partial";
			playlistUri: string;
			spotifyId: string;
			/** Number of tracks that failed to add. */
			failedTrackCount: number;
	  }
	| { status: "error"; message: string };

const SPOTIFY_PLAYLIST_URI_RE = /^spotify:playlist:([a-zA-Z0-9]+)$/;

function parseSpotifyId(uri: string): string | null {
	const match = uri.match(SPOTIFY_PLAYLIST_URI_RE);
	return match ? match[1] : null;
}

export async function createPlaylistFromDraft(
	input: CreatePlaylistFromDraftInput,
): Promise<CreatePlaylistFromDraftResult> {
	// Step 1: extension reachability
	const installed = await isExtensionInstalled();
	if (!installed) {
		return { status: "extension-unavailable" };
	}

	// Step 2: Spotify connection
	const connected = await getSpotifyConnectionStatus();
	if (!connected) {
		return { status: "reconnect-required" };
	}

	// Step 3: resolve Spotify userId from the account row (set during extension sync)
	let userId: string;
	try {
		const userIdResult = await resolveSpotifyUserId();
		if (!userIdResult.spotifyUserId) {
			// account.spotify_id is null — user has never completed an extension sync
			// with a logged-in Spotify session. Treat as reconnect-required.
			return { status: "reconnect-required" };
		}
		userId = userIdResult.spotifyUserId;
	} catch {
		return { status: "error", message: "Failed to resolve Spotify user ID" };
	}

	// Step 4: create the playlist on Spotify + acknowledge to DB
	const createResult = await createPlaylistAcknowledged(input.name, userId);
	if (!createResult.ok) {
		const outcome = outcomeFromAcknowledgedResult(createResult);
		if (outcome.status === "reconnect-required") {
			return { status: "reconnect-required" };
		}
		if (outcome.status === "extension-unavailable") {
			return { status: "extension-unavailable" };
		}
		return { status: "error", message: "Playlist creation failed" };
	}

	const playlistUri = createResult.data.uri;
	const spotifyId = parseSpotifyId(playlistUri);
	if (!spotifyId) {
		return {
			status: "error",
			message: `Invalid playlist URI returned: ${playlistUri}`,
		};
	}

	// The Spotify create succeeded but the DB acknowledge write never landed
	// (even after the bounded retries inside createPlaylistAcknowledged). The
	// playlist exists on Spotify with no local row. We must NOT fall through to
	// persistNewPlaylistConfig — its ownership guard reads the (missing) row and
	// throws "Playlist not found", which would be misreported as an all-tracks
	// failure and tempt a full re-create (a duplicate Spotify playlist). Surface
	// the honest state so the caller can resume from acknowledge/config instead.
	if (!createResult.acknowledged) {
		return { status: "created-unsynced", playlistUri, spotifyId };
	}

	return finalizePlaylistCreate(playlistUri, spotifyId, input);
}

/**
 * Resumes a create that stopped at "created-unsynced": the Spotify playlist
 * already exists (playlistUri/spotifyId), but its DB row and config were never
 * written. Re-drives the acknowledge (idempotent upsert) and, once the row
 * exists, the config + track-add steps against the EXISTING playlist. It never
 * calls createPlaylist, so it cannot produce a duplicate Spotify playlist.
 *
 * Callers pass the SAME draft input used for the original attempt so the draft's
 * config (genre pills, match filters, intent) and track adds are preserved.
 */
export async function resumePlaylistCreateFromDraft(
	input: CreatePlaylistFromDraftInput,
	playlistUri: string,
	spotifyId: string,
): Promise<CreatePlaylistFromDraftResult> {
	const ack = await acknowledgeCreateWithRetry(playlistUri, input.name);
	if (!ack.acknowledged) {
		// Still couldn't write the row — stay unsynced so the user can retry again.
		return { status: "created-unsynced", playlistUri, spotifyId };
	}

	return finalizePlaylistCreate(playlistUri, spotifyId, input);
}

/**
 * Steps 5–7 of the commit, shared by the initial create and the resume path.
 * Assumes the DB playlist row already exists (acknowledge succeeded):
 *   5. persist match config server-side and resolve ordered track URIs
 *   6. bulk addToPlaylist for the previewed tracks
 *   7. record match_decision "added" rows (non-fatal, fire-and-forget)
 */
async function finalizePlaylistCreate(
	playlistUri: string,
	spotifyId: string,
	input: CreatePlaylistFromDraftInput,
): Promise<CreatePlaylistFromDraftResult> {
	// Step 5: persist match config and resolve ordered track URIs.
	// persistNewPlaylistConfig does both in one server round-trip:
	//   - writes match_intent (only if eligible) / genre_pills / match_filters
	//   - returns the ordered spotify:track:... URIs for the previewed songs
	let trackUris: string[];
	try {
		const configResult = await persistNewPlaylistConfig({
			data: {
				spotifyId,
				songIds: input.songIds,
				intent: input.intent,
				genrePills: input.genrePills,
				matchFilters: input.matchFilters,
				intentApplied: input.intentApplied,
			},
		});
		trackUris = configResult.trackUris;
	} catch {
		// Config persist failed — playlist exists but has no config or tracks.
		// Report partial so the user can see the playlist and retry.
		return {
			status: "partial",
			playlistUri,
			spotifyId,
			failedTrackCount: input.songIds.length,
		};
	}

	// Step 6: bulk-add the previewed tracks to the new Spotify playlist.
	// addToPlaylist accepts an array of URIs — this is a single command (no loop).
	if (trackUris.length > 0) {
		const addResult = await addToPlaylist(playlistUri, trackUris);
		const addOutcome = outcomeFromCommandResponse(addResult);

		if (addOutcome.status !== "success") {
			// Playlist was created and config is persisted; only the track-add failed.
			return {
				status: "partial",
				playlistUri,
				spotifyId,
				failedTrackCount: trackUris.length,
			};
		}
	}

	// Step 7: record match_decision "added" rows (non-fatal, fire-and-forget).
	// These prevent the same songs from re-surfacing as suggestions for this playlist.
	// Errors here must not block the success path.
	recordPlaylistMatchDecisions({
		data: { spotifyId, songIds: input.songIds },
	}).catch((err) => {
		console.error(
			"[createPlaylistFromDraft] match_decision record failed (non-fatal):",
			err,
		);
	});

	return { status: "success", playlistUri, spotifyId };
}

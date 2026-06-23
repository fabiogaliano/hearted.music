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
import { createPlaylistAcknowledged } from "./playlist-write-acknowledgement";
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

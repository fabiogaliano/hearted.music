/**
 * Composes extension command execution with server acknowledgement
 * for playlist-level writes (create, update, delete).
 *
 * Two-step model: extension executes the Spotify mutation,
 * then the server persists the confirmed outcome into app DB.
 */

import {
	acknowledgePlaylistCreate,
	acknowledgePlaylistDelete,
	acknowledgePlaylistUpdate,
} from "@/lib/server/playlists.functions";
import type { CommandResponse } from "../../../shared/spotify-command-protocol";
import {
	createPlaylist,
	deletePlaylist,
	updatePlaylist,
} from "./spotify-client";

type CreatePlaylistResult = { uri: string; revision: string };
type UpdatePlaylistResult = { revision: string };
type DeletePlaylistResult = { revision: string };

export type AcknowledgedResult<T> =
	| { ok: true; data: T; acknowledged: true }
	| { ok: true; data: T; acknowledged: false; acknowledgeError: unknown }
	| { ok: false; commandResponse: CommandResponse<T> };

export type AcknowledgeCreateOutcome =
	| { acknowledged: true }
	| { acknowledged: false; acknowledgeError: unknown };

// Backoff between acknowledge attempts. The Spotify create already succeeded at
// this point, so the playlist exists but the DB row may not — a transient DB
// blip is worth a couple of quick retries before surfacing an unsynced state.
// acknowledgePlaylistCreate is an idempotent upsert, so retrying is safe.
const ACK_RETRY_DELAYS_MS = [150, 400];

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempts to acknowledge a completed Spotify playlist create into the DB,
 * retrying a small bounded number of times on failure. The underlying
 * acknowledgePlaylistCreate is an upsert keyed by spotify_id, so re-running it
 * never duplicates the row — this only heals a DB write that transiently failed.
 *
 * Exported so the orchestrator's resume path can re-drive acknowledgement
 * against an already-created Spotify playlist without re-creating it.
 */
export async function acknowledgeCreateWithRetry(
	uri: string,
	name: string,
): Promise<AcknowledgeCreateOutcome> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= ACK_RETRY_DELAYS_MS.length; attempt++) {
		try {
			await acknowledgePlaylistCreate({ data: { uri, name } });
			return { acknowledged: true };
		} catch (error) {
			lastError = error;
			const delay = ACK_RETRY_DELAYS_MS[attempt];
			if (delay !== undefined) await sleep(delay);
		}
	}
	return { acknowledged: false, acknowledgeError: lastError };
}

export async function createPlaylistAcknowledged(
	name: string,
	userId: string,
): Promise<AcknowledgedResult<CreatePlaylistResult>> {
	const response = await createPlaylist(name, userId);

	if (!response.ok) {
		return { ok: false, commandResponse: response };
	}

	const ack = await acknowledgeCreateWithRetry(response.data.uri, name);
	if (ack.acknowledged) {
		return { ok: true, data: response.data, acknowledged: true };
	}
	return {
		ok: true,
		data: response.data,
		acknowledged: false,
		acknowledgeError: ack.acknowledgeError,
	};
}

export async function updatePlaylistAcknowledged(
	playlistId: string,
	attrs: {
		name?: string;
		description?: string;
		songCount?: number;
		imageUrl?: string | null;
	},
): Promise<AcknowledgedResult<UpdatePlaylistResult>> {
	const response = await updatePlaylist(playlistId, {
		name: attrs.name,
		description: attrs.description,
	});

	if (!response.ok) {
		return { ok: false, commandResponse: response };
	}

	try {
		await acknowledgePlaylistUpdate({
			data: { spotifyId: playlistId, ...attrs },
		});
		return { ok: true, data: response.data, acknowledged: true };
	} catch (error) {
		return {
			ok: true,
			data: response.data,
			acknowledged: false,
			acknowledgeError: error,
		};
	}
}

export async function deletePlaylistAcknowledged(
	playlistUri: string,
	userId: string,
): Promise<AcknowledgedResult<DeletePlaylistResult>> {
	const response = await deletePlaylist(playlistUri, userId);

	if (!response.ok) {
		return { ok: false, commandResponse: response };
	}

	try {
		await acknowledgePlaylistDelete({ data: { uri: playlistUri } });
		return { ok: true, data: response.data, acknowledged: true };
	} catch (error) {
		return {
			ok: true,
			data: response.data,
			acknowledged: false,
			acknowledgeError: error,
		};
	}
}

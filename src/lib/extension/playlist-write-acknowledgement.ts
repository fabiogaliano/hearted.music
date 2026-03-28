/**
 * Composes extension command execution with server acknowledgement
 * for playlist-level writes (create, update, delete).
 *
 * Two-step model: extension executes the Spotify mutation,
 * then the server persists the confirmed outcome into app DB.
 */

import type { CommandResponse } from "../../../shared/spotify-command-protocol";
import {
	createPlaylist,
	updatePlaylist,
	deletePlaylist,
} from "./spotify-client";
import {
	acknowledgePlaylistCreate,
	acknowledgePlaylistUpdate,
	acknowledgePlaylistDelete,
} from "@/lib/server/playlists.functions";

type CreatePlaylistResult = { uri: string; revision: string };
type UpdatePlaylistResult = { revision: string };
type DeletePlaylistResult = { revision: string };

export type AcknowledgedResult<T> =
	| { ok: true; data: T; acknowledged: true }
	| { ok: true; data: T; acknowledged: false; acknowledgeError: unknown }
	| { ok: false; commandResponse: CommandResponse<T> };

export async function createPlaylistAcknowledged(
	name: string,
	userId: string,
): Promise<AcknowledgedResult<CreatePlaylistResult>> {
	const response = await createPlaylist(name, userId);

	if (!response.ok) {
		return { ok: false, commandResponse: response };
	}

	try {
		await acknowledgePlaylistCreate({ data: { uri: response.data.uri, name } });
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

export async function updatePlaylistAcknowledged(
	playlistId: string,
	attrs: { name?: string; description?: string },
): Promise<AcknowledgedResult<UpdatePlaylistResult>> {
	const response = await updatePlaylist(playlistId, attrs);

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

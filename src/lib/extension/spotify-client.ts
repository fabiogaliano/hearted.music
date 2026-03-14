import { sendExtensionCommand } from "./detect";
import {
	SPOTIFY_PROTOCOL_VERSION,
	createSpotifyCommand,
	type CommandResponse,
	type SpotifyCommandMap,
	type SpotifyCommandName,
	type SpotifyErrorCode,
} from "../../../shared/spotify-command-protocol";

type AddToPlaylistResult = { typename: string };
type RemoveFromPlaylistResult = { typename: string };
type CreatePlaylistResult = { uri: string; revision: string };
type UpdatePlaylistResult = { revision: string };
type DeletePlaylistResult = { revision: string };

type ArtistImageSource = { url: string; width: number; height: number };
type ArtistOverviewResult = {
	id: string;
	name: string;
	avatarImages: ArtistImageSource[];
};

type SpotifyCommandResultMap = {
	addToPlaylist: AddToPlaylistResult;
	removeFromPlaylist: RemoveFromPlaylistResult;
	createPlaylist: CreatePlaylistResult;
	updatePlaylist: UpdatePlaylistResult;
	deletePlaylist: DeletePlaylistResult;
	queryArtistOverview: ArtistOverviewResult;
};

function generateCommandId(): string {
	return crypto.randomUUID();
}

async function sendSpotifyCommand<K extends SpotifyCommandName>(
	command: K,
	payload: SpotifyCommandMap[K],
): Promise<CommandResponse<SpotifyCommandResultMap[K]>> {
	const commandId = generateCommandId();
	const commandMessage = createSpotifyCommand({
		command,
		payload,
		commandId,
		protocolVersion: SPOTIFY_PROTOCOL_VERSION,
	});

	const response =
		await sendExtensionCommand<CommandResponse<SpotifyCommandResultMap[K]>>(
			commandMessage,
		);

	if (!response) {
		const errorCode: SpotifyErrorCode = "NETWORK_ERROR";
		return {
			ok: false,
			errorCode,
			message: "Extension not available",
			retryable: false,
			commandId,
		};
	}

	return response;
}

export async function addToPlaylist(
	playlistUri: string,
	trackUris: string[],
	position: "BOTTOM_OF_PLAYLIST" | "TOP_OF_PLAYLIST" = "BOTTOM_OF_PLAYLIST",
): Promise<CommandResponse<AddToPlaylistResult>> {
	return sendSpotifyCommand("addToPlaylist", {
		playlistUri,
		trackUris,
		position,
	});
}

export async function removeFromPlaylist(
	playlistUri: string,
	uids: string[],
): Promise<CommandResponse<RemoveFromPlaylistResult>> {
	return sendSpotifyCommand("removeFromPlaylist", {
		playlistUri,
		uids,
	});
}

export async function createPlaylist(
	name: string,
	userId: string,
): Promise<CommandResponse<CreatePlaylistResult>> {
	return sendSpotifyCommand("createPlaylist", {
		name,
		userId,
	});
}

export async function updatePlaylist(
	playlistId: string,
	attrs: { name?: string; description?: string },
): Promise<CommandResponse<UpdatePlaylistResult>> {
	return sendSpotifyCommand("updatePlaylist", {
		playlistId,
		...attrs,
	});
}

export async function deletePlaylist(
	playlistUri: string,
	userId: string,
): Promise<CommandResponse<DeletePlaylistResult>> {
	return sendSpotifyCommand("deletePlaylist", {
		playlistUri,
		userId,
	});
}

export async function queryArtistOverview(
	artistUri: string,
	locale?: string,
): Promise<CommandResponse<ArtistOverviewResult>> {
	return sendSpotifyCommand("queryArtistOverview", {
		artistUri,
		locale,
	});
}

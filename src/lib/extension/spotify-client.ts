import {
	type CommandResponse,
	createSpotifyCommand,
	type PlaylistMovePosition,
	SPOTIFY_PROTOCOL_VERSION,
	type SpotifyCommandMap,
	type SpotifyCommandName,
	type SpotifyErrorCode,
} from "../../../shared/spotify-command-protocol";
import { sendExtensionCommand } from "./detect";

type AddToPlaylistResult = { typename: string };
type RemoveFromPlaylistResult = { typename: string };
type MoveInPlaylistResult = { typename: string };
type CreatePlaylistResult = { uri: string; revision: string };
type UpdatePlaylistResult = { revision: string };
type DeletePlaylistResult = { revision: string };
type UploadPlaylistCoverResult = { revision: string; picture: string };
type RemovePlaylistCoverResult = { revision: string };
type SetPlaylistVisibilityResult = { revision: string };

type ArtistImageSource = { url: string; width: number; height: number };
type ArtistOverviewResult = {
	id: string;
	name: string;
	avatarImages: ArtistImageSource[];
};

type PlaylistMetadataResult = {
	name: string;
	description: string | null;
	trackCount: number;
	imageUrl: string | null;
};

type SpotifyCommandResultMap = {
	addToPlaylist: AddToPlaylistResult;
	removeFromPlaylist: RemoveFromPlaylistResult;
	moveInPlaylist: MoveInPlaylistResult;
	createPlaylist: CreatePlaylistResult;
	updatePlaylist: UpdatePlaylistResult;
	deletePlaylist: DeletePlaylistResult;
	uploadPlaylistCover: UploadPlaylistCoverResult;
	removePlaylistCover: RemovePlaylistCoverResult;
	setPlaylistVisibility: SetPlaylistVisibilityResult;
	queryArtistOverview: ArtistOverviewResult;
	fetchPlaylistMetadata: PlaylistMetadataResult;
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

export async function moveInPlaylist(
	playlistUri: string,
	uids: string[],
	newPosition: PlaylistMovePosition,
): Promise<CommandResponse<MoveInPlaylistResult>> {
	return sendSpotifyCommand("moveInPlaylist", {
		playlistUri,
		uids,
		newPosition,
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

/**
 * Sets a playlist's cover image. `imageBase64` is a JPEG as base64 (raw or a
 * `data:image/...;base64,` data URL), max 10MB — the extension enforces the limit
 * and returns INVALID_PARAMS for anything larger.
 */
export async function uploadPlaylistCover(
	playlistId: string,
	imageBase64: string,
): Promise<CommandResponse<UploadPlaylistCoverResult>> {
	return sendSpotifyCommand("uploadPlaylistCover", {
		playlistId,
		imageBase64,
	});
}

export async function removePlaylistCover(
	playlistId: string,
): Promise<CommandResponse<RemovePlaylistCoverResult>> {
	return sendSpotifyCommand("removePlaylistCover", {
		playlistId,
	});
}

/**
 * Sets a playlist's profile visibility (Spotify's "public" flag — whether it
 * shows on your profile and is discoverable, not link access control).
 */
export async function setPlaylistVisibility(
	playlistUri: string,
	userId: string,
	isPublic: boolean,
): Promise<CommandResponse<SetPlaylistVisibilityResult>> {
	return sendSpotifyCommand("setPlaylistVisibility", {
		playlistUri,
		userId,
		isPublic,
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

export async function fetchPlaylistMetadata(
	playlistUri: string,
): Promise<CommandResponse<PlaylistMetadataResult>> {
	return sendSpotifyCommand("fetchPlaylistMetadata", {
		playlistUri,
	});
}

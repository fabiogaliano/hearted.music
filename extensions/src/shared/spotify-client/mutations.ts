import { queryPathfinder } from "../pathfinder";
import type {
	PathfinderAddToPlaylistResponse,
	PathfinderMoveInPlaylistResponse,
	PathfinderRemoveFromPlaylistResponse,
} from "./responses.types";
import type {
	AddToPlaylistResult,
	MoveInPlaylistResult,
	PlaylistMovePosition,
	RemoveFromPlaylistResult,
} from "./types";

export async function addToPlaylist(
	token: string,
	playlistUri: string,
	trackUris: string[],
	position: "BOTTOM_OF_PLAYLIST" | "TOP_OF_PLAYLIST" = "BOTTOM_OF_PLAYLIST",
): Promise<AddToPlaylistResult> {
	const data = await queryPathfinder<PathfinderAddToPlaylistResponse>(
		token,
		"addToPlaylist",
		{
			playlistUri,
			playlistItemUris: trackUris,
			newPosition: {
				moveType: position,
				fromUid: null,
			},
		},
	);

	return {
		typename: data.data.addItemsToPlaylist.__typename,
	};
}

/**
 * Reorders items already in a playlist. Shares the persisted query with
 * add/remove; `uids` are the items to move and `newPosition` anchors them
 * (e.g. BEFORE_UID a given item, or TOP/BOTTOM of the playlist).
 */
export async function moveInPlaylist(
	token: string,
	playlistUri: string,
	uids: string[],
	newPosition: PlaylistMovePosition,
): Promise<MoveInPlaylistResult> {
	const data = await queryPathfinder<PathfinderMoveInPlaylistResponse>(
		token,
		"moveItemsInPlaylist",
		{
			playlistUri,
			uids,
			newPosition,
		},
	);

	return {
		typename: data.data.moveItemsInPlaylist.__typename,
	};
}

export async function removeFromPlaylist(
	token: string,
	playlistUri: string,
	uids: string[],
): Promise<RemoveFromPlaylistResult> {
	const data = await queryPathfinder<PathfinderRemoveFromPlaylistResponse>(
		token,
		"removeFromPlaylist",
		{
			playlistUri,
			uids,
		},
	);

	return {
		typename: data.data.removeItemsFromPlaylist.__typename,
	};
}

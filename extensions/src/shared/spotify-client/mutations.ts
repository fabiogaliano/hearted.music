import { queryPathfinder } from "../pathfinder";
import type {
	PathfinderAddToPlaylistResponse,
	PathfinderRemoveFromPlaylistResponse,
} from "./responses.types";
import type { AddToPlaylistResult, RemoveFromPlaylistResult } from "./types";

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

import { addToPlaylist, removeFromPlaylist } from "./mutations";
import { createPlaylist, deletePlaylist, updatePlaylist } from "./playlist-v2";
import {
	fetchAllLikedTracks,
	fetchPlaylistTracks,
	fetchUserPlaylists,
	getCurrentUserProfile,
	queryArtistOverview,
} from "./reads";
import type { SpotifyClient } from "./types";

export function createSpotifyClient(): SpotifyClient {
	return {
		getCurrentUserProfile,
		fetchAllLikedTracks: async (token, onProgress) => {
			const tracks = await fetchAllLikedTracks(token, onProgress);
			return {
				tracks,
				totalCount: tracks.length,
			};
		},
		fetchUserPlaylists: async (token) => {
			const profile = await getCurrentUserProfile(token);
			const userUri = `spotify:user:${profile.spotifyId}`;
			const playlists = await fetchUserPlaylists(token, userUri);
			return { playlists };
		},
		fetchPlaylistTracks: async (token, playlistUri) => {
			const tracks = await fetchPlaylistTracks(token, playlistUri);
			return { tracks };
		},
		queryArtistOverview,
		addToPlaylist: async (token, playlistUri, trackUris, position) => {
			return addToPlaylist(token, playlistUri, trackUris, position);
		},
		removeFromPlaylist: async (token, playlistUri, uids) => {
			return removeFromPlaylist(token, playlistUri, uids);
		},
		createPlaylist,
		updatePlaylist,
		deletePlaylist,
	};
}

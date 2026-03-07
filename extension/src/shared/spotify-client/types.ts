import type {
	SpotifyTrackDTO,
	SpotifyPlaylistDTO,
	UserProfile,
} from "../types";
import type {
	PathfinderAddToPlaylistResponse,
	PathfinderQueryArtistOverviewResponse,
	PathfinderRemoveFromPlaylistResponse,
	PlaylistV2ChangesResponse,
	PlaylistV2CreateResponse,
} from "./responses.types";

// --- Read Operation Results ---

export type FetchLibraryTracksResult = {
	tracks: SpotifyTrackDTO[];
	totalCount: number;
};

export type FetchPlaylistsResult = {
	playlists: SpotifyPlaylistDTO[];
};

export type FetchPlaylistTracksResult = {
	tracks: SpotifyTrackDTO[];
};

export type ArtistImageSource = NonNullable<
	NonNullable<
		PathfinderQueryArtistOverviewResponse["data"]["artistUnion"]["visuals"]
	>["avatarImage"]
>["sources"][number];

export type ArtistOverviewResult = {
	id: PathfinderQueryArtistOverviewResponse["data"]["artistUnion"]["id"];
	name: PathfinderQueryArtistOverviewResponse["data"]["artistUnion"]["profile"]["name"];
	avatarImages: ArtistImageSource[];
};

// --- Write Operation Results ---

export type AddToPlaylistResult = {
	typename: PathfinderAddToPlaylistResponse["data"]["addItemsToPlaylist"]["__typename"];
};

export type RemoveFromPlaylistResult = {
	typename: PathfinderRemoveFromPlaylistResponse["data"]["removeItemsFromPlaylist"]["__typename"];
};

export type CreatePlaylistResult = PlaylistV2CreateResponse;

export type UpdatePlaylistResult = PlaylistV2ChangesResponse;

export type DeletePlaylistResult = PlaylistV2ChangesResponse;

// --- Progress Callback ---

export type ProgressCallback = (fetched: number, total: number) => void;

// --- SpotifyClient Interface ---

export type SpotifyClient = {
	// Reads
	getCurrentUserProfile: (token: string) => Promise<UserProfile>;
	fetchAllLikedTracks: (
		token: string,
		onProgress?: ProgressCallback,
	) => Promise<FetchLibraryTracksResult>;
	fetchUserPlaylists: (token: string) => Promise<FetchPlaylistsResult>;
	fetchPlaylistTracks: (
		token: string,
		playlistUri: string,
	) => Promise<FetchPlaylistTracksResult>;
	queryArtistOverview: (
		token: string,
		artistUri: string,
		locale?: string,
	) => Promise<ArtistOverviewResult>;

	// Writes
	addToPlaylist: (
		token: string,
		playlistUri: string,
		trackUris: string[],
		position?: "BOTTOM_OF_PLAYLIST" | "TOP_OF_PLAYLIST",
	) => Promise<AddToPlaylistResult>;
	removeFromPlaylist: (
		token: string,
		playlistUri: string,
		uids: string[],
	) => Promise<RemoveFromPlaylistResult>;

	// Playlist v2 operations
	createPlaylist: (
		token: string,
		name: string,
		userId: string,
	) => Promise<CreatePlaylistResult>;
	updatePlaylist: (
		token: string,
		playlistId: string,
		attrs: { name?: string; description?: string },
	) => Promise<UpdatePlaylistResult>;
	deletePlaylist: (
		token: string,
		playlistUri: string,
		userId: string,
	) => Promise<DeletePlaylistResult>;
};

// --- Unsupported Operation Error ---

export class UnsupportedOperationError extends Error {
	readonly code = "UNSUPPORTED_OPERATION" as const;

	constructor(operation: string) {
		super(`Unsupported operation: ${operation}`);
		this.name = "UnsupportedOperationError";
	}
}

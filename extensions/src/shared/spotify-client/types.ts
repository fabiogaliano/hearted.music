import type {
	SpotifyPlaylistDTO,
	SpotifyTrackDTO,
	UserProfile,
} from "../types";
import type {
	PathfinderAddToPlaylistResponse,
	PathfinderMoveInPlaylistResponse,
	PathfinderQueryArtistOverviewResponse,
	PathfinderRemoveFromPlaylistResponse,
	PlaylistV2ChangesResponse,
	PlaylistV2CreateResponse,
} from "./responses.types";

export type PlaylistMovePosition = {
	moveType:
		| "BEFORE_UID"
		| "AFTER_UID"
		| "TOP_OF_PLAYLIST"
		| "BOTTOM_OF_PLAYLIST";
	/** Anchor item the moved items land relative to; null for TOP/BOTTOM moves. */
	fromUid: string | null;
};

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
	bio: string | null;
};

export type TrackResult = {
	id: string;
	uri: string;
	name: string;
	durationMs: number;
	albumId: string;
	albumName: string;
	albumCoverArt: Array<{ url: string; width: number; height: number }>;
	artists: Array<{ id: string; name: string }>;
	/** Album release year (albumOfTrack.date.year); null when absent/unparseable. */
	releaseYear: number | null;
};

// --- Write Operation Results ---

export type AddToPlaylistResult = {
	typename: PathfinderAddToPlaylistResponse["data"]["addItemsToPlaylist"]["__typename"];
};

export type RemoveFromPlaylistResult = {
	typename: PathfinderRemoveFromPlaylistResponse["data"]["removeItemsFromPlaylist"]["__typename"];
};

export type MoveInPlaylistResult = {
	typename: PathfinderMoveInPlaylistResponse["data"]["moveItemsInPlaylist"]["__typename"];
};

export type CreatePlaylistResult = PlaylistV2CreateResponse;

export type UpdatePlaylistResult = PlaylistV2ChangesResponse;

export type DeletePlaylistResult = PlaylistV2ChangesResponse;

export type UploadPlaylistCoverResult = {
	revision: PlaylistV2ChangesResponse["revision"];
	picture: string;
};

export type RemovePlaylistCoverResult = {
	revision: PlaylistV2ChangesResponse["revision"];
};

export type SetPlaylistVisibilityResult = {
	revision: PlaylistV2ChangesResponse["revision"];
};

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
	moveInPlaylist: (
		token: string,
		playlistUri: string,
		uids: string[],
		newPosition: PlaylistMovePosition,
	) => Promise<MoveInPlaylistResult>;

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
	uploadPlaylistCover: (
		token: string,
		playlistId: string,
		imageBase64: string,
	) => Promise<UploadPlaylistCoverResult>;
	removePlaylistCover: (
		token: string,
		playlistId: string,
	) => Promise<RemovePlaylistCoverResult>;
	setPlaylistVisibility: (
		token: string,
		playlistUri: string,
		userId: string,
		isPublic: boolean,
	) => Promise<SetPlaylistVisibilityResult>;
};

// --- Unsupported Operation Error ---

export class UnsupportedOperationError extends Error {
	readonly code = "UNSUPPORTED_OPERATION" as const;

	constructor(operation: string) {
		super(`Unsupported operation: ${operation}`);
		this.name = "UnsupportedOperationError";
	}
}

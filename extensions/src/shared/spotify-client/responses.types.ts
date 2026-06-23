import type { FetchLibraryTracks } from "./contracts/pathfinder/fetchLibraryTracks.types";
import type { FetchPlaylistContents } from "./contracts/pathfinder/fetchPlaylistContents.types";
import type { GetTrack } from "./contracts/pathfinder/getTrack.types";
import type { IsCurated } from "./contracts/pathfinder/isCurated.types";
import type { LibraryV3 } from "./contracts/pathfinder/libraryV3.types";
import type { ProfileAttributes } from "./contracts/pathfinder/profileAttributes.types";
import type { QueryArtistOverview } from "./contracts/pathfinder/queryArtistOverview.types";
import type {
	ImageUploadContract,
	PlaylistV2CreateContract as PlaylistV2CreateContractBase,
	PlaylistV2RegisterImageContract,
	PlaylistV2RevisionContract,
} from "./contracts/playlist-v2.types";

// Pathfinder read contracts (sourced from captured API response type files)
export type PathfinderProfileAttributesResponse = ProfileAttributes;
export type PathfinderFetchLibraryTracksResponse = FetchLibraryTracks;
export type PathfinderLibraryV3Response = LibraryV3;
export type PathfinderFetchPlaylistContentsResponse = FetchPlaylistContents;
export type PathfinderQueryArtistOverviewResponse = QueryArtistOverview;
export type PathfinderGetTrackResponse = GetTrack;
export type PathfinderIsCuratedResponse = IsCurated;

export type PathfinderLibraryTrackItem =
	PathfinderFetchLibraryTracksResponse["data"]["me"]["library"]["tracks"]["items"][number];

export type PathfinderLibraryV3Item =
	PathfinderLibraryV3Response["data"]["me"]["libraryV3"]["items"][number];

export type PathfinderPlaylistContentItem =
	PathfinderFetchPlaylistContentsResponse["data"]["playlistV2"]["content"]["items"][number];

type RawArtistVisuals = NonNullable<
	PathfinderQueryArtistOverviewResponse["data"]["artistUnion"]["visuals"]
>;

type RawArtistAvatarImage = NonNullable<RawArtistVisuals["avatarImage"]>;

export type PathfinderImageSource = RawArtistAvatarImage["sources"][number];

// Pathfinder mutation contracts (persisted-query responses)
export interface PathfinderAddToPlaylistResponse {
	data: {
		addItemsToPlaylist: {
			__typename: string;
		};
	};
}

export interface PathfinderRemoveFromPlaylistResponse {
	data: {
		removeItemsFromPlaylist: {
			__typename: string;
		};
	};
}

export interface PathfinderMoveInPlaylistResponse {
	data: {
		moveItemsInPlaylist: {
			__typename: string;
		};
	};
}

// Playlist v2 write contracts (spclient REST responses)
export type PlaylistV2CreateContract = PlaylistV2CreateContractBase;
export type PlaylistV2ChangesContract = PlaylistV2RevisionContract;

export type PlaylistV2RegisterImageResponse = PlaylistV2RegisterImageContract;
export type ImageUploadResponse = ImageUploadContract;

// Backward-compatible aliases
export type PlaylistV2CreateResponse = PlaylistV2CreateContract;
export type PlaylistV2ChangesResponse = PlaylistV2ChangesContract;

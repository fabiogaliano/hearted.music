import {
	extractId,
	mapPathfinderPlaylist,
	mapPathfinderPlaylistTrack,
	mapPathfinderTrack,
} from "../mappers";
import { queryPathfinder } from "../pathfinder";
import type {
	SpotifyPlaylistDTO,
	SpotifyTrackDTO,
	UserProfile,
} from "../types";
import type {
	PathfinderFetchLibraryTracksResponse,
	PathfinderFetchPlaylistContentsResponse,
	PathfinderLibraryV3Response,
	PathfinderProfileAttributesResponse,
	PathfinderQueryArtistOverviewResponse,
} from "./responses.types";
import type { ArtistOverviewResult, ProgressCallback } from "./types";

export async function getCurrentUserProfile(
	token: string,
): Promise<UserProfile> {
	const data = await queryPathfinder<PathfinderProfileAttributesResponse>(
		token,
		"profileAttributes",
		{},
	);
	const profile = data.data.me.profile;
	const avatarSources = profile.avatar?.sources ?? [];
	const largestAvatar =
		avatarSources.length > 0
			? avatarSources.reduce((best, s) => (s.width > best.width ? s : best))
			: null;

	return {
		spotifyId: extractId(profile.uri),
		displayName: profile.name,
		username: profile.username,
		avatarUrl: largestAvatar?.url ?? null,
	};
}

export async function fetchAllLikedTracks(
	token: string,
	onProgress?: ProgressCallback,
): Promise<SpotifyTrackDTO[]> {
	const allTracks: SpotifyTrackDTO[] = [];
	let offset = 0;
	const limit = 50;
	let total = Infinity;

	while (offset < total) {
		const data = await queryPathfinder<PathfinderFetchLibraryTracksResponse>(
			token,
			"fetchLibraryTracks",
			{ offset, limit },
		);
		const tracks = data.data?.me?.library?.tracks;
		const items = tracks?.items ?? [];
		total = tracks?.totalCount ?? items.length;

		const mapped = items
			.map(mapPathfinderTrack)
			.filter((t): t is SpotifyTrackDTO => t !== null);
		allTracks.push(...mapped);
		offset += limit;

		onProgress?.(allTracks.length, total);
		console.log(`[hearted.] Fetched ${allTracks.length}/${total} liked tracks`);

		if (offset < total) {
			await new Promise((r) => setTimeout(r, 200));
		}
	}

	return allTracks;
}

export async function fetchUserPlaylists(
	token: string,
	userUri: string,
): Promise<SpotifyPlaylistDTO[]> {
	const allPlaylists: SpotifyPlaylistDTO[] = [];
	let offset = 0;
	const limit = 50;
	let total = Infinity;

	while (offset < total) {
		const data = await queryPathfinder<PathfinderLibraryV3Response>(
			token,
			"libraryV3",
			{
				filters: ["Playlists"],
				order: null,
				textFilter: "",
				features: ["LIKED_SONGS", "YOUR_EPISODES_V2", "PRERELEASES", "EVENTS"],
				limit,
				offset,
				flatten: true,
				expandedFolders: [],
				folderUri: null,
				includeFoldersWhenFlattening: true,
			},
		);
		const library = data.data?.me?.libraryV3;
		const items = library?.items ?? [];
		total = library?.totalCount ?? items.length;

		const mapped = items
			.filter((item) => {
				const typename = item.item?.data?.__typename;
				if (typename !== "Playlist") return false;
				const ownerUri = item.item?.data?.ownerV2?.data?.uri;
				return ownerUri === userUri;
			})
			.map(mapPathfinderPlaylist)
			.filter((playlist): playlist is SpotifyPlaylistDTO => playlist !== null);
		allPlaylists.push(...mapped);
		offset += limit;

		console.log(
			`[hearted.] Fetched ${allPlaylists.length} owned playlists (scanned ${offset}/${total})`,
		);

		if (offset < total) {
			await new Promise((r) => setTimeout(r, 200));
		}
	}

	return allPlaylists;
}

export async function fetchPlaylistTracks(
	token: string,
	playlistUri: string,
): Promise<SpotifyTrackDTO[]> {
	const allTracks: SpotifyTrackDTO[] = [];
	let offset = 0;
	const limit = 50;
	let total = Infinity;

	while (offset < total) {
		const data = await queryPathfinder<PathfinderFetchPlaylistContentsResponse>(
			token,
			"fetchPlaylistContents",
			{ uri: playlistUri, offset, limit },
		);
		const content = data.data?.playlistV2?.content;
		const items = content?.items ?? [];
		total = content?.totalCount ?? items.length;

		const mapped = items
			.map(mapPathfinderPlaylistTrack)
			.filter((t): t is SpotifyTrackDTO => t !== null);
		allTracks.push(...mapped);
		offset += limit;

		console.log(`[hearted.] Playlist tracks: ${allTracks.length}/${total}`);

		if (offset < total) {
			await new Promise((r) => setTimeout(r, 200));
		}
	}

	return allTracks;
}

export async function queryArtistOverview(
	token: string,
	artistUri: string,
	locale: string = "en",
): Promise<ArtistOverviewResult> {
	const data = await queryPathfinder<PathfinderQueryArtistOverviewResponse>(
		token,
		"queryArtistOverview",
		{ uri: artistUri, locale },
	);
	const artist = data.data.artistUnion;
	const sources = artist.visuals?.avatarImage?.sources ?? [];

	return {
		id: artist.id,
		name: artist.profile.name,
		avatarImages: sources.map((s) => ({
			url: s.url,
			width: s.width,
			height: s.height,
		})),
	};
}

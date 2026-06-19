import {
	extractId,
	mapPathfinderPlaylist,
	mapPathfinderPlaylistTrack,
	mapPathfinderTrack,
} from "../mappers";

const HTML_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	mdash: "—",
	ndash: "–",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getNestedRecord(
	value: unknown,
	key: string,
): Record<string, unknown> | null {
	if (!isRecord(value)) return null;
	const nested = value[key];
	return isRecord(nested) ? nested : null;
}

function decodeHtmlEntities(text: string): string {
	const stripped = text.replace(/<[^>]+>/g, "");
	return stripped.replace(
		/&(#(?:x[0-9a-fA-F]+|\d+)|\w+);/g,
		(match, entity: string) => {
			if (entity.startsWith("#x"))
				return String.fromCodePoint(parseInt(entity.slice(2), 16));
			if (entity.startsWith("#"))
				return String.fromCodePoint(parseInt(entity.slice(1), 10));
			return HTML_ENTITIES[entity] ?? match;
		},
	);
}

import { queryPathfinder } from "../pathfinder";
import type {
	SpotifyPlaylistDTO,
	SpotifyTrackDTO,
	UserProfile,
} from "../types";
import type {
	PathfinderFetchLibraryTracksResponse,
	PathfinderFetchPlaylistContentsResponse,
	PathfinderGetTrackResponse,
	PathfinderLibraryV3Response,
	PathfinderProfileAttributesResponse,
	PathfinderQueryArtistOverviewResponse,
} from "./responses.types";
import type {
	ArtistOverviewResult,
	ProgressCallback,
	TrackResult,
} from "./types";

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
	}

	return allTracks;
}

export async function fetchUserPlaylists(
	token: string,
	userUri: string,
	onProgress?: ProgressCallback,
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

		onProgress?.(allPlaylists.length, total);

		console.log(
			`[hearted.] Fetched ${allPlaylists.length} owned playlists (scanned ${offset}/${total})`,
		);
	}

	return allPlaylists;
}

export async function fetchPlaylistTracks(
	token: string,
	playlistUri: string,
	onProgress?: ProgressCallback,
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

		onProgress?.(allTracks.length, total);

		console.log(`[hearted.] Playlist tracks: ${allTracks.length}/${total}`);
	}

	return allTracks;
}

export async function queryArtistOverview(
	token: string,
	artistUri: string,
	locale: string = "",
): Promise<ArtistOverviewResult> {
	const data = await queryPathfinder<PathfinderQueryArtistOverviewResponse>(
		token,
		"queryArtistOverview",
		{ uri: artistUri, locale, preReleaseV2: false },
	);
	const artist = data.data.artistUnion;
	const sources = artist.visuals?.avatarImage?.sources ?? [];
	const profileAny = artist.profile as unknown as {
		biography?: { text: string };
	};
	const rawBio = profileAny.biography?.text ?? null;
	const bio = rawBio ? decodeHtmlEntities(rawBio) : null;

	return {
		id: artist.id,
		name: artist.profile.name,
		avatarImages: sources.map((s) => ({
			url: s.url,
			width: s.width,
			height: s.height,
		})),
		bio,
	};
}

export type PlaylistMetadataResult = {
	name: string;
	description: string | null;
	trackCount: number;
	imageUrl: string | null;
};

function extractImageUrlFromSources(
	playlist: Record<string, unknown>,
): string | null {
	const images = getNestedRecord(playlist, "images");
	if (!images || !Array.isArray(images.items) || images.items.length === 0)
		return null;
	const firstImageItem = images.items[0];
	if (!isRecord(firstImageItem)) return null;
	const sources = (firstImageItem as Record<string, unknown>).sources;
	if (!Array.isArray(sources) || sources.length === 0) return null;
	let best: { url: string; width: number } | null = null;
	for (const src of sources) {
		if (!isRecord(src) || typeof src.url !== "string") continue;
		const width = typeof src.width === "number" ? src.width : 0;
		if (!best || width > best.width) {
			best = { url: src.url, width };
		}
	}
	return best?.url ?? null;
}

export async function fetchPlaylistMetadata(
	token: string,
	playlistUri: string,
): Promise<PlaylistMetadataResult> {
	const data = await queryPathfinder<unknown>(token, "fetchPlaylist", {
		uri: playlistUri,
		offset: 0,
		limit: 1,
		enableWatchFeedEntrypoint: true,
		includeEpisodeContentRatingsV2: false,
	});

	const envelope = getNestedRecord(data, "data");
	const playlist = getNestedRecord(envelope, "playlistV2");

	if (!playlist || typeof playlist.name !== "string") {
		throw new Error(
			`Unexpected fetchPlaylistMetadata shape for ${playlistUri}`,
		);
	}

	const name = playlist.name;
	const rawDescription = playlist.description;
	const description =
		typeof rawDescription === "string" && rawDescription.length > 0
			? rawDescription
			: null;

	const content = getNestedRecord(playlist, "content");
	const rawTotalCount = content?.totalCount;
	const trackCount = typeof rawTotalCount === "number" ? rawTotalCount : 0;

	const imageUrl = extractImageUrlFromSources(playlist);

	return { name, description, trackCount, imageUrl };
}

export async function getTrack(
	token: string,
	trackUri: string,
): Promise<TrackResult> {
	const data = await queryPathfinder<PathfinderGetTrackResponse>(
		token,
		"getTrack",
		{ uri: trackUri },
	);
	const t = data.data.trackUnion;
	const allArtists = [
		...(t.firstArtist?.items ?? []),
		...(t.otherArtists?.items ?? []),
	];

	// Unlike the bulk fetchLibraryTracks query, getTrack carries the album release
	// date — this is what lets liked songs get a release year at sync time.
	const year = t.albumOfTrack.date?.year;
	const releaseYear = typeof year === "number" && year > 0 ? year : null;

	return {
		id: t.id,
		uri: t.uri,
		name: t.name,
		durationMs: t.duration.totalMilliseconds,
		albumId: t.albumOfTrack.id,
		albumName: t.albumOfTrack.name,
		albumCoverArt: t.albumOfTrack.coverArt?.sources ?? [],
		artists: allArtists.map((a) => ({
			id: a.id,
			name: a.profile.name,
		})),
		releaseYear,
	};
}

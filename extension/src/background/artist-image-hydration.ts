import { queryArtistOverview } from "../shared/spotify-client/reads";
import { setSyncState } from "../shared/storage";
import type { SpotifyTrackDTO } from "../shared/types";

const ARTIST_OVERVIEW_CONCURRENCY = 8;

type ArtistImageRecord = {
	spotify_id: string;
	image_url: string;
};

type ArtistImageCheckResponse = {
	artists: ArtistImageRecord[];
};

export type PostToBackend = (
	path: string,
	body: Record<string, unknown>,
) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isArtistImageRecord(value: unknown): value is ArtistImageRecord {
	return (
		isRecord(value) &&
		typeof value.spotify_id === "string" &&
		typeof value.image_url === "string"
	);
}

function parseArtistImageCheckResponse(
	value: unknown,
): ArtistImageCheckResponse | null {
	if (!isRecord(value) || !Array.isArray(value.artists)) {
		return null;
	}

	const artists: ArtistImageRecord[] = [];
	for (const artist of value.artists) {
		if (!isArtistImageRecord(artist)) {
			return null;
		}
		artists.push(artist);
	}

	return { artists };
}

export function pickBestArtistImageUrl(
	artist: Awaited<ReturnType<typeof queryArtistOverview>>,
): string | null {
	if (artist.avatarImages.length === 0) {
		return null;
	}

	const bestImage = artist.avatarImages.reduce((best, current) => {
		const bestArea = (best.width ?? 0) * (best.height ?? 0);
		const currentArea = (current.width ?? 0) * (current.height ?? 0);
		return currentArea > bestArea ? current : best;
	});

	return bestImage.url;
}

function collectArtistsNeedingHydration(tracks: SpotifyTrackDTO[]): {
	artistImageUrls: Map<string, string | null>;
	artistsToHydrate: Map<string, string>;
} {
	const artistImageUrls = new Map<string, string | null>();
	const artistsToHydrate = new Map<string, string>();

	for (const track of tracks) {
		for (const artist of track.track.artists) {
			if (artist.imageUrl != null) {
				artistImageUrls.set(artist.id, artist.imageUrl);
				artistsToHydrate.delete(artist.id);
				continue;
			}

			if (!artistImageUrls.has(artist.id) && !artistsToHydrate.has(artist.id)) {
				artistsToHydrate.set(artist.id, artist.name);
			}
		}
	}

	return { artistImageUrls, artistsToHydrate };
}

async function hydrateArtistsFromBackend(params: {
	artistImageUrls: Map<string, string | null>;
	artistsToHydrate: Map<string, string>;
	postToBackend: PostToBackend;
}): Promise<void> {
	const { artistImageUrls, artistsToHydrate, postToBackend } = params;
	const artistIds = [...artistsToHydrate.keys()];

	if (artistIds.length === 0) {
		return;
	}

	try {
		const response = await postToBackend("/api/extension/artists/check", {
			artistIds,
		});

		if (!response.ok) {
			console.warn(
				`[hearted.] Artist image precheck failed with HTTP ${response.status}; falling back to Spotify hydration`,
			);
			return;
		}

		const body: unknown = await response.json();
		const parsed = parseArtistImageCheckResponse(body);
		if (!parsed) {
			console.warn(
				"[hearted.] Artist image precheck returned an invalid payload; falling back to Spotify hydration",
			);
			return;
		}

		for (const artist of parsed.artists) {
			artistImageUrls.set(artist.spotify_id, artist.image_url);
			artistsToHydrate.delete(artist.spotify_id);
		}

		console.log(
			`[hearted.] Artist image precheck found ${parsed.artists.length}/${artistIds.length} artists with cached images`,
		);
	} catch (error) {
		console.warn(
			"[hearted.] Artist image precheck failed; falling back to Spotify hydration:",
			error,
		);
	}
}

export async function fetchArtistImageUrls(params: {
	token: string;
	tracks: SpotifyTrackDTO[];
	postToBackend: PostToBackend;
}): Promise<Map<string, string | null>> {
	const { token, tracks, postToBackend } = params;
	const { artistImageUrls, artistsToHydrate } =
		collectArtistsNeedingHydration(tracks);

	await hydrateArtistsFromBackend({
		artistImageUrls,
		artistsToHydrate,
		postToBackend,
	});

	const artistEntries = [...artistsToHydrate.entries()];
	let hydratedArtists = 0;
	await setSyncState({
		phase: "artistImages",
		fetched: hydratedArtists,
		total: artistEntries.length,
		artistImages: { fetched: hydratedArtists, total: artistEntries.length },
	});

	for (
		let index = 0;
		index < artistEntries.length;
		index += ARTIST_OVERVIEW_CONCURRENCY
	) {
		const batch = artistEntries.slice(
			index,
			index + ARTIST_OVERVIEW_CONCURRENCY,
		);
		const results = await Promise.allSettled(
			batch.map(async ([artistId]) => {
				const artistOverview = await queryArtistOverview(
					token,
					`spotify:artist:${artistId}`,
				);
				return {
					artistId,
					imageUrl: pickBestArtistImageUrl(artistOverview),
				};
			}),
		);

		results.forEach((result, batchIndex) => {
			const [artistId, artistName] = batch[batchIndex];

			if (result.status === "fulfilled") {
				artistImageUrls.set(result.value.artistId, result.value.imageUrl);
				return;
			}

			artistImageUrls.set(artistId, null);
			console.warn(
				`[hearted.] Failed to fetch artist overview for ${artistName} (${artistId}):`,
				result.reason,
			);
		});

		hydratedArtists += batch.length;
		await setSyncState({
			phase: "artistImages",
			fetched: hydratedArtists,
			total: artistEntries.length,
			artistImages: { fetched: hydratedArtists, total: artistEntries.length },
		});
	}

	return artistImageUrls;
}

export function attachArtistImagesToTracks(
	tracks: SpotifyTrackDTO[],
	artistImageUrls: ReadonlyMap<string, string | null>,
): SpotifyTrackDTO[] {
	return tracks.map((track) => ({
		...track,
		track: {
			...track.track,
			artists: track.track.artists.map((artist) => ({
				...artist,
				imageUrl: artistImageUrls.get(artist.id) ?? null,
			})),
		},
	}));
}

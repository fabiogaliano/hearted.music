import type {
	PathfinderLibraryTrackItem,
	PathfinderLibraryV3Item,
	PathfinderPlaylistContentItem,
} from "./spotify-client/responses.types";
import type { SpotifyPlaylistDTO, SpotifyTrackDTO } from "./types";

export function extractId(uri: string): string {
	return uri.split(":").pop() as string;
}

/** Pulls the release year from a pathfinder isoString ("2019-03-29" or
 *  "1975-11-21T00:00:00Z"). Returns null for missing/unparseable values. */
function parseReleaseYear(isoString: string | null | undefined): number | null {
	if (!isoString) return null;
	const year = Number.parseInt(isoString.slice(0, 4), 10);
	return Number.isInteger(year) && year > 0 ? year : null;
}

/** Maps a pathfinder liked-track item (fetchLibraryTracks response).
 *  URI is on the wrapper (`item.track._uri`), not on `item.track.data`. */
export function mapPathfinderTrack(
	item: PathfinderLibraryTrackItem,
): SpotifyTrackDTO | null {
	if (!item.track?._uri?.startsWith("spotify:track:")) return null;

	const trackUri: string = item.track._uri;
	const track = item.track.data;

	return {
		added_at: item.addedAt.isoString,
		track: {
			id: extractId(trackUri),
			name: track.name,
			artists: (track.artists?.items ?? []).map((a) => ({
				id: extractId(a.uri),
				name: a.profile?.name ?? "",
			})),
			album: {
				id: extractId(track.albumOfTrack?.uri ?? ""),
				name: track.albumOfTrack?.name ?? "",
				images: track.albumOfTrack?.coverArt?.sources ?? [],
			},
			duration_ms: track.duration.totalMilliseconds,
			uri: trackUri,
		},
	};
}

/** Maps a libraryV3 playlist item — path is item.item.data */
export function mapPathfinderPlaylist(
	item: PathfinderLibraryV3Item,
): SpotifyPlaylistDTO | null {
	const data = item.item.data;
	if (typeof data.uri !== "string" || typeof data.name !== "string") {
		return null;
	}

	const owner = data.ownerV2?.data;
	const ownerUri = typeof owner?.uri === "string" ? owner.uri : "";
	const ownerName =
		typeof owner?.name === "string"
			? owner.name
			: typeof owner?.username === "string"
				? owner.username
				: "";

	return {
		id: extractId(data.uri),
		name: data.name,
		description: data.description || null,
		owner: {
			id: ownerUri ? extractId(ownerUri) : "",
			name: ownerName,
			image_url: owner?.avatar?.sources?.[0]?.url,
		},
		track_count: data.count ?? null,
		image_url: data.images?.items?.[0]?.sources?.[0]?.url ?? null,
	};
}

/** Maps a playlist track item (fetchPlaylistContents response) — track in itemV2.data.
 *  Uses `trackDuration` (not `duration`). URI is on `itemV2.data.uri`. */
export function mapPathfinderPlaylistTrack(
	item: PathfinderPlaylistContentItem,
): SpotifyTrackDTO | null {
	const track = item.itemV2?.data;
	if (!track || track.__typename !== "Track") {
		return null;
	}

	// Release year lives on the itemV3 branch (album = contentHierarchyParent),
	// not on itemV2's albumOfTrack — so it's read separately from the same item.
	const releaseYear = parseReleaseYear(
		item.itemV3?.data?.identityTrait?.contentHierarchyParent
			?.publishingMetadataTrait?.firstPublishedAt?.isoString,
	);

	return {
		added_at: item.addedAt?.isoString ?? new Date().toISOString(),
		track: {
			id: extractId(track.uri),
			name: track.name,
			artists: (track.artists?.items ?? []).map((a) => ({
				id: extractId(a.uri),
				name: a.profile?.name ?? "",
			})),
			album: {
				id: extractId(track.albumOfTrack?.uri ?? ""),
				name: track.albumOfTrack?.name ?? "",
				images: track.albumOfTrack?.coverArt?.sources ?? [],
			},
			duration_ms: track.trackDuration?.totalMilliseconds ?? 0,
			uri: track.uri,
			release_year: releaseYear,
		},
	};
}

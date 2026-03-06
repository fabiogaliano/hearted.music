import type { SpotifyTrackDTO, SpotifyPlaylistDTO } from "./types";

export function extractId(uri: string): string {
	return uri.split(":").pop()!;
}

/** Maps a pathfinder liked-track item (fetchLibraryTracks response).
 *  URI is on the wrapper (`item.track._uri`), not on `item.track.data`. */
export function mapPathfinderTrack(item: any): SpotifyTrackDTO | null {
	if (!item.track?._uri?.startsWith("spotify:track:")) return null;

	const trackUri: string = item.track._uri;
	const track = item.track.data;

	return {
		added_at: item.addedAt.isoString,
		track: {
			id: extractId(trackUri),
			name: track.name,
			artists: track.artists.items.map((a: any) => ({
				id: extractId(a.uri),
				name: a.profile.name,
			})),
			album: {
				id: extractId(track.albumOfTrack.uri),
				name: track.albumOfTrack.name,
				images: track.albumOfTrack.coverArt.sources,
			},
			duration_ms: track.duration.totalMilliseconds,
			uri: trackUri,
		},
	};
}

/** Maps a libraryV3 playlist item — path is item.item.data */
export function mapPathfinderPlaylist(item: any): SpotifyPlaylistDTO {
	const data = item.item.data;
	const owner = data.ownerV2?.data;

	return {
		id: extractId(data.uri),
		name: data.name,
		description: data.description || null,
		owner: {
			id: extractId(owner.uri),
			name: owner.name || owner.username,
			image_url: owner.avatar?.sources?.[0]?.url ?? null,
		},
		track_count: data.content?.totalCount ?? 0,
		image_url: data.images?.items?.[0]?.sources?.[0]?.url ?? null,
	};
}

/** Maps a playlist track item (fetchPlaylistContents response) — track in itemV2.data.
 *  Uses `trackDuration` (not `duration`). URI is on `itemV2.data.uri`. */
export function mapPathfinderPlaylistTrack(item: any): SpotifyTrackDTO | null {
	const track = item.itemV2?.data;
	if (!track || track.__typename !== "Track") {
		return null;
	}

	return {
		added_at: item.addedAt?.isoString ?? new Date().toISOString(),
		track: {
			id: extractId(track.uri),
			name: track.name,
			artists: track.artists.items.map((a: any) => ({
				id: extractId(a.uri),
				name: a.profile.name,
			})),
			album: {
				id: extractId(track.albumOfTrack.uri),
				name: track.albumOfTrack.name,
				images: track.albumOfTrack.coverArt.sources,
			},
			duration_ms: track.trackDuration.totalMilliseconds,
			uri: track.uri,
		},
	};
}

/**
 * Adapter: a live `LikedSong` row -> the `SongDetail` the song-detail panel renders.
 *
 * Always returns a SongDetail so every selected song opens the panel. The stored
 * analysis arrives already decoded on the server (`decodeStoredAnalysis`), so this
 * only maps its `kind` onto the panel's `read` / `instrumentalRead` slots.
 *
 * `read` is null when the row has no analysis, is locked (analysis omitted), or
 * holds a shape that matches neither read. `instrumentalRead` is non-null only for
 * instrumental rows. Both null = unresolved or undecodable.
 */

import type { StoredAnalysis } from "@/lib/domains/enrichment/content-analysis/read-schema";
import type { ThemeColor } from "@/lib/theme/types";
import type { LikedSong } from "../../types";
import type { SongDetail } from "./song-detail-types";

function readSlots(
	stored: StoredAnalysis | undefined,
): Pick<SongDetail, "read" | "instrumentalRead"> {
	if (!stored) return { read: null, instrumentalRead: null };
	switch (stored.kind) {
		case "lyrical":
			return { read: stored.read, instrumentalRead: null };
		case "instrumental":
			return { read: null, instrumentalRead: stored.read };
		case "none":
			return { read: null, instrumentalRead: null };
	}
}

export function likedSongToSongDetail(
	song: LikedSong,
	themeColor: ThemeColor,
): SongDetail {
	const stored = song.analysis?.analysis;

	// Live audio features come from the track row; the read's stored copy is the
	// fallback for rows whose track features weren't joined.
	const trackFeatures = song.track.audio_features;
	const storedFeatures = stored?.audioFeatures;

	return {
		id: song.track.id,
		spotifyTrackId: song.track.spotify_track_id,
		title: song.track.name,
		artist: song.track.artist,
		album: song.track.album ?? "",
		genres: song.track.genres,
		audioFeatures: {
			tempo: trackFeatures?.tempo ?? storedFeatures?.tempo ?? null,
			energy: trackFeatures?.energy ?? storedFeatures?.energy ?? null,
			valence: trackFeatures?.valence ?? storedFeatures?.valence ?? null,
		},
		theme: themeColor,
		albumArtUrl: song.track.image_url ?? undefined,
		artistImageUrl: song.track.artist_image_url ?? undefined,
		displayState: song.displayState,
		contentFetchStatus: song.contentFetchStatus ?? null,
		...readSlots(stored),
	};
}

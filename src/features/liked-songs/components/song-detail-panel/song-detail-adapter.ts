/**
 * Adapter: a live `LikedSong` row -> the `SongDetail` the song-detail panel renders.
 *
 * Always returns a SongDetail so every selected song opens the panel. The
 * persisted analysis is the source of truth for the read: from lyrical v17 on,
 * song-analysis.ts validates generation against SongReadSchema and stores the
 * read FLAT (buildAnalysisData spreads the read fields and tacks on an extra
 * `audio_features` key), so the stored JSON is `{ ...SongRead, audio_features }`.
 * Parsing it back through SongReadSchema validates it and strips the extra
 * `audio_features` key, leaving a clean SongRead.
 *
 * `read` is null when the row has no analysis, is locked (analysis omitted), or is
 * an old 8-field row that predates v17 — none of those parse as a SongRead. The
 * panel renders the hero + a minimal "not analyzed yet" state for those rows.
 */

import { SongReadSchema } from "@/lib/domains/enrichment/content-analysis/read-schema";
import type { ThemeColor } from "@/lib/theme/types";
import type { LikedSong } from "../../types";
import type { SongDetail } from "./song-detail-types";

export function likedSongToSongDetail(
	song: LikedSong,
	themeColor: ThemeColor,
): SongDetail {
	const stored = song.analysis?.analysis;
	const parsed = stored ? SongReadSchema.safeParse(stored) : null;
	const read = parsed?.success ? parsed.data : null;

	// Live audio features come from the track row; the read's stored copy is the
	// fallback for rows whose track features weren't joined.
	const trackFeatures = song.track.audio_features;
	const storedFeatures = stored?.audio_features;

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
		read,
	};
}

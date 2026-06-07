/**
 * Adapter: a live `LikedSong` row -> the `ConceptSong` the song-detail panel renders.
 *
 * Always returns a ConceptSong so every selected song opens the panel. The
 * persisted analysis is the source of truth for the read: from lyrical v17 on,
 * song-analysis.ts validates generation against ConceptReadSchema and stores the
 * read FLAT (buildAnalysisData spreads the read fields and tacks on an extra
 * `audio_features` key), so the stored JSON is `{ ...ConceptRead, audio_features }`.
 * Parsing it back through ConceptReadSchema validates it and strips the extra
 * `audio_features` key, leaving a clean ConceptRead.
 *
 * `read` is null when the row has no analysis, is locked (analysis omitted), or is
 * an old 8-field row that predates v17 — none of those parse as a ConceptRead. The
 * panel renders the hero + a minimal "not analyzed yet" state for those rows.
 */

import { ConceptReadSchema } from "@/lib/domains/enrichment/content-analysis/concept-schema";
import type { ThemeColor } from "@/lib/theme/types";
import type { LikedSong } from "../../types";
import type { ConceptSong } from "./concept-types";

export function likedSongToConceptSong(
	song: LikedSong,
	themeColor: ThemeColor,
): ConceptSong {
	const stored = song.analysis?.analysis;
	const parsed = stored ? ConceptReadSchema.safeParse(stored) : null;
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
			tempo: trackFeatures?.tempo ?? storedFeatures?.tempo ?? 0,
			energy: trackFeatures?.energy ?? storedFeatures?.energy ?? 0,
			valence: trackFeatures?.valence ?? storedFeatures?.valence ?? 0,
		},
		theme: themeColor,
		albumArtUrl: song.track.image_url ?? undefined,
		artistImageUrl: song.track.artist_image_url ?? undefined,
		read,
	};
}

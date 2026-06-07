/**
 * Adapter: a live `LikedSong` row -> the `ConceptSong` the ConceptPanel renders.
 *
 * The persisted analysis is the source of truth for the read. From lyrical v17
 * on, song-analysis.ts validates generation against ConceptReadSchema and stores
 * the read FLAT (buildAnalysisData spreads the read fields and tacks on an extra
 * `audio_features` key). So the stored JSON is `{ ...ConceptRead, audio_features }`.
 * Parsing it back through ConceptReadSchema both validates it and strips the extra
 * `audio_features` key, leaving a clean ConceptRead.
 *
 * Returns null when the row has no analysis, is locked (analysis omitted), or is
 * an old 8-field row that predates v17 — none of those parse as a ConceptRead.
 * Callers fall back to the legacy SongDetailPanel for those rows.
 */

import { ConceptReadSchema } from "@/lib/domains/enrichment/content-analysis/concept-schema";
import type { ThemeColor } from "@/lib/theme/types";
import type { LikedSong } from "../../types";
import type { ConceptSong } from "./concept-types";

export function likedSongToConceptSong(
	song: LikedSong,
	themeColor: ThemeColor,
): ConceptSong | null {
	const stored = song.analysis?.analysis;
	if (!stored) return null;

	const parsed = ConceptReadSchema.safeParse(stored);
	if (!parsed.success) return null;

	// Live audio features come from the track row; the read's stored copy is the
	// fallback for rows whose track features weren't joined.
	const trackFeatures = song.track.audio_features;
	const storedFeatures = stored.audio_features;

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
		read: parsed.data,
	};
}

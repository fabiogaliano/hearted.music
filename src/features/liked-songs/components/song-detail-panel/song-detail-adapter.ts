/**
 * Adapter: a live `LikedSong` row -> the `SongDetail` the song-detail panel renders.
 *
 * Always returns a SongDetail so every selected song opens the panel. The
 * persisted analysis is the source of truth for the read: from lyrical v17 on,
 * song-analysis.ts validates generation against SongReadSchema and stores the
 * read FLAT (buildAnalysisData spreads the read fields and tacks on an extra
 * `audio_features` key), so the stored JSON is `{ ...SongRead, audio_features }`.
 * Parsing it back through SongReadSchema validates it and strips the extra
 * `audio_features` key, leaving a clean SongRead. Instrumental analysis rows
 * follow the same flat-spread convention with { headline, compound_mood,
 * sonic_texture, mood_description, audio_features? } — parsed via
 * SongAnalysisInstrumentalSchema.
 *
 * `read` is null when the row has no analysis, is locked (analysis omitted), or is
 * an old 8-field row that predates v17. `instrumentalRead` is non-null only for
 * confirmed-instrumental rows. Both null = unresolved or pre-v17.
 */

import { SongReadSchema } from "@/lib/domains/enrichment/content-analysis/read-schema";
import { SongAnalysisInstrumentalSchema } from "@/lib/domains/enrichment/content-analysis/song-analysis";
import type { ThemeColor } from "@/lib/theme/types";
import type { LikedSong } from "../../types";
import type { SongDetail } from "./song-detail-types";

export function likedSongToSongDetail(
	song: LikedSong,
	themeColor: ThemeColor,
): SongDetail {
	const stored = song.analysis?.analysis;

	// Both parses run against the same stored blob. SongReadSchema requires the
	// lyrical fields (image/lens/tension/take/arc/lines); SongAnalysisInstrumental
	// requires the instrumental fields (headline/compound_mood/sonic_texture/
	// mood_description). The two shapes are mutually exclusive in practice, so
	// exactly one will succeed for a valid analysis row.
	const lyricalParsed = stored ? SongReadSchema.safeParse(stored) : null;
	const instrumentalParsed = stored
		? SongAnalysisInstrumentalSchema.safeParse(stored)
		: null;

	const read = lyricalParsed?.success ? lyricalParsed.data : null;
	const instrumentalRead = instrumentalParsed?.success
		? instrumentalParsed.data
		: null;

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
		contentFetchStatus: song.contentFetchStatus ?? null,
		read,
		instrumentalRead,
	};
}

/**
 * View-model types for the playlist creation feature.
 *
 * SongVM is a flattened, client-safe representation of a song candidate in
 * the draft preview engine. It carries enough data to render a song row
 * (name, artist, artwork) plus the fields needed for the preview list
 * (genres, duration, score). It is NOT a DB row — it is assembled by the
 * draft engine from joined song + audio-feature + liked-song data.
 */

export interface SongVM {
	/** Internal UUID — used as a stable React key and for pinned/excluded tracking. */
	id: string;
	/** Spotify track ID — used to add tracks to the Spotify playlist at commit time. */
	spotifyId: string;
	name: string;
	/** Primary artist display name (first entry in the artists array). */
	artist: string;
	album: string | null;
	imageUrl: string | null;
	genres: string[];
	durationMs: number | null;
	/**
	 * Normalized [0, 1] match score produced by the preview engine.
	 * Present when scored; absent for pinned songs inserted before scoring.
	 */
	matchScore?: number;
}

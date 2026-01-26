/**
 * Spotify entity to database insert shape mappers.
 *
 * Transform-only functions that convert Spotify API responses
 * to Supabase insert shapes. Persistence is handled by the data layer.
 */

import type { TablesInsert } from "@/lib/data/database.types";
import type { SpotifyPlaylistDTO, SpotifyTrackDTO } from "./service";

/**
 * Maps a Spotify track DTO to a song insert shape.
 *
 * @example
 * ```ts
 * const spotifyTrack = await spotify.getLikedTracks();
 * const songInserts = spotifyTrack.map(mapTrackToSongInsert);
 * await db.insertSongs(songInserts);
 * ```
 */
export function mapTrackToSongInsert(
	dto: SpotifyTrackDTO,
): TablesInsert<"song"> {
	return {
		spotify_id: dto.track.id,
		name: dto.track.name,
		artists: dto.track.artists.map((a) => a.name),
		album_id: dto.track.album.id,
		album_name: dto.track.album.name,
		duration_ms: dto.track.duration_ms,
	};
}

/**
 * Maps a Spotify track DTO to a liked_song insert shape.
 * Requires the account_id and song_id (from the songs table after upsert).
 */
export function mapTrackToLikedSongInsert(
	dto: SpotifyTrackDTO,
	accountId: string,
	songId: string,
): TablesInsert<"liked_song"> {
	return {
		account_id: accountId,
		song_id: songId,
		liked_at: dto.added_at,
	};
}

/**
 * Maps a Spotify playlist DTO to a playlist insert shape.
 */
export function mapPlaylistToPlaylistInsert(
	dto: SpotifyPlaylistDTO,
	accountId: string,
): TablesInsert<"playlist"> {
	return {
		account_id: accountId,
		spotify_id: dto.id,
		name: dto.name,
		description: dto.description,
		song_count: dto.track_count,
		image_url: dto.image_url,
	};
}

/**
 * Maps a Spotify track DTO to a playlist_song insert shape.
 * Requires the playlist_id and song_id, plus position in the playlist.
 */
export function mapTrackToPlaylistSongInsert(
	dto: SpotifyTrackDTO,
	playlistId: string,
	songId: string,
	position: number,
): TablesInsert<"playlist_song"> {
	return {
		playlist_id: playlistId,
		song_id: songId,
		position,
		added_at: dto.added_at,
	};
}

/**
 * Batch mapper for tracks to song inserts.
 * Useful for bulk operations.
 */
export function mapTracksToSongInserts(
	dtos: SpotifyTrackDTO[],
): TablesInsert<"song">[] {
	return dtos.map(mapTrackToSongInsert);
}

/**
 * Batch mapper for playlists to playlist inserts.
 */
export function mapPlaylistsToPlaylistInserts(
	dtos: SpotifyPlaylistDTO[],
	accountId: string,
): TablesInsert<"playlist">[] {
	return dtos.map((dto) => mapPlaylistToPlaylistInsert(dto, accountId));
}

// ============================================================================
// Anti-Corruption Layer: Data Normalization
// ============================================================================

/**
 * Deduplicates Spotify tracks by spotify_id, keeping first occurrence.
 *
 * Business rule: Spotify allows duplicate songs in playlists; we keep first occurrence only.
 * This is an Anti-Corruption Layer pattern - transform external data to our domain rules.
 *
 * Also filters out null tracks (local files, deleted tracks).
 *
 * @example
 * ```ts
 * const tracks = await spotify.getPlaylistTracks(playlistId);
 * const uniqueTracks = dedupeTracksBySpotifyId(tracks);
 * // uniqueTracks has no duplicates and no null tracks
 * ```
 */
export function dedupeTracksBySpotifyId<
	T extends { track: { id: string } | null },
>(tracks: T[]): T[] {
	const seen = new Set<string>();
	return tracks.filter((t): t is T & { track: { id: string } } => {
		if (!t.track) return false;
		if (seen.has(t.track.id)) return false;
		seen.add(t.track.id);
		return true;
	});
}

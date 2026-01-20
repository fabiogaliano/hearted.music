/**
 * Playlist and playlist-song data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Tables, TablesInsert } from "./database.types";

// ============================================================================
// Type Exports
// ============================================================================

/** Playlist row type */
export type Playlist = Tables<"playlist">;

/** Playlist-song junction row type */
export type PlaylistSong = Tables<"playlist_song">;

/** Insert type for upserting playlists */
export type UpsertPlaylistData = Pick<
	TablesInsert<"playlist">,
	| "spotify_id"
	| "name"
	| "description"
	| "snapshot_id"
	| "is_public"
	| "song_count"
	| "is_destination"
>;

/** Insert type for upserting playlist songs */
export type UpsertPlaylistSongData = Pick<
	TablesInsert<"playlist_song">,
	"song_id" | "position" | "added_at"
>;

// ============================================================================
// Playlist Operations
// ============================================================================

/**
 * Gets a playlist by its UUID.
 * Returns null if not found (not an error).
 */
export function getPlaylistById(
	id: string,
): Promise<Result<Playlist | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase.from("playlist").select("*").eq("id", id).single(),
	);
}

/**
 * Gets a playlist by Spotify playlist ID for a specific account.
 * Returns null if not found (not an error).
 */
export function getPlaylistBySpotifyId(
	accountId: string,
	spotifyId: string,
): Promise<Result<Playlist | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("playlist")
			.select("*")
			.eq("account_id", accountId)
			.eq("spotify_id", spotifyId)
			.single(),
	);
}

/**
 * Gets all playlists for an account.
 * Returns empty array if none found.
 */
export function getPlaylists(
	accountId: string,
): Promise<Result<Playlist[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("playlist")
			.select("*")
			.eq("account_id", accountId)
			.order("name", { ascending: true }),
	);
}

/**
 * Gets all destination playlists for an account.
 * Destination playlists are targets for auto-sorting liked songs.
 * Returns empty array if none found.
 */
export function getDestinationPlaylists(
	accountId: string,
): Promise<Result<Playlist[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("playlist")
			.select("*")
			.eq("account_id", accountId)
			.eq("is_destination", true)
			.order("name", { ascending: true }),
	);
}

/**
 * Creates or updates playlists for an account based on Spotify ID.
 * Uses (account_id, spotify_id) as the conflict target.
 * Returns all upserted playlists.
 */
export function upsertPlaylists(
	accountId: string,
	playlists: UpsertPlaylistData[],
): Promise<Result<Playlist[], DbError>> {
	if (playlists.length === 0) {
		return Promise.resolve(Result.ok<Playlist[], DbError>([]));
	}
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("playlist")
			.upsert(
				playlists.map((playlist) => ({
					account_id: accountId,
					spotify_id: playlist.spotify_id,
					name: playlist.name,
					description: playlist.description,
					snapshot_id: playlist.snapshot_id,
					is_public: playlist.is_public,
					song_count: playlist.song_count,
					is_destination: playlist.is_destination,
				})),
				{ onConflict: "account_id,spotify_id" },
			)
			.select(),
	);
}

/**
 * Deletes a playlist by ID.
 * Note: This cascades to playlist_song due to FK constraint.
 */
export function deletePlaylist(id: string): Promise<Result<null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase.from("playlist").delete().eq("id", id).single(),
	);
}

/**
 * Sets whether a playlist is a destination for auto-sorting.
 * Returns the updated playlist.
 */
export function setPlaylistDestination(
	id: string,
	isDestination: boolean,
): Promise<Result<Playlist, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("playlist")
			.update({ is_destination: isDestination })
			.eq("id", id)
			.select()
			.single(),
	);
}

// ============================================================================
// Playlist-Song Junction Operations
// ============================================================================

/**
 * Gets all songs in a playlist with their positions.
 * Returns empty array if none found.
 */
export function getPlaylistSongs(
	playlistId: string,
): Promise<Result<PlaylistSong[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("playlist_song")
			.select("*")
			.eq("playlist_id", playlistId)
			.order("position", { ascending: true }),
	);
}

/**
 * Creates or updates songs in a playlist.
 * Uses (playlist_id, song_id) as the conflict target.
 * Returns all upserted playlist-song records.
 */
export function upsertPlaylistSongs(
	playlistId: string,
	songs: UpsertPlaylistSongData[],
): Promise<Result<PlaylistSong[], DbError>> {
	if (songs.length === 0) {
		return Promise.resolve(Result.ok<PlaylistSong[], DbError>([]));
	}
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("playlist_song")
			.upsert(
				songs.map((song) => ({
					playlist_id: playlistId,
					song_id: song.song_id,
					position: song.position,
					added_at: song.added_at,
				})),
				{ onConflict: "playlist_id,song_id" },
			)
			.select(),
	);
}

/**
 * Removes songs from a playlist by song IDs.
 * Note: This is a hard delete since playlist_song is a junction table.
 */
export async function removePlaylistSongs(
	playlistId: string,
	songIds: string[],
): Promise<Result<null, DbError>> {
	if (songIds.length === 0) {
		return Result.ok(null);
	}
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("playlist_song")
			.delete()
			.eq("playlist_id", playlistId)
			.in("song_id", songIds)
			.select(),
	);
	if (Result.isError(result)) {
		return Result.err(result.error);
	}
	return Result.ok(null);
}

/**
 * Playlist and playlist-song data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type {
	Json,
	Tables,
	TablesInsert,
	TablesUpdate,
} from "@/lib/data/database.types";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import {
	chunkedWrite,
	DB_IN_FILTER_CHUNK_SIZE,
} from "@/lib/shared/utils/chunked-write";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";

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
	| "is_target"
	| "image_url"
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
 * Gets a playlist by its UUID, scoped to the owning account.
 * Returns null if not found or not owned by the account (not an error).
 *
 * The account_id filter is the authorization boundary: the service-role client
 * bypasses RLS, so a non-owned id must return null rather than another tenant's
 * playlist. Callers may still re-check ownership, but safety no longer depends
 * on them doing so.
 */
export function getPlaylistById(
	accountId: string,
	id: string,
): Promise<Result<Playlist | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("playlist")
			.select("*")
			.eq("id", id)
			.eq("account_id", accountId)
			.single(),
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
 * Counts playlists for an account (efficient - no data transfer).
 * Uses Supabase's count feature for O(1) DB operation.
 */
export async function getPlaylistCount(
	accountId: string,
): Promise<Result<number, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { count, error } = await supabase
		.from("playlist")
		.select("*", { count: "exact", head: true })
		.eq("account_id", accountId);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(count ?? 0);
}

export async function getPlaylistSongCount(
	accountId: string,
): Promise<Result<number, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { count, error } = await supabase
		.from("playlist_song")
		.select("*, playlist!inner(account_id)", { count: "exact", head: true })
		.eq("playlist.account_id", accountId);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(count ?? 0);
}

/**
 * Gets all target playlists for an account.
 * Target playlists are the ones liked songs get auto-sorted into.
 * Returns empty array if none found.
 */
export function getTargetPlaylists(
	accountId: string,
): Promise<Result<Playlist[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("playlist")
			.select("*")
			.eq("account_id", accountId)
			.eq("is_target", true)
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
	return chunkedWrite(playlists, (chunk) =>
		fromSupabaseMany(
			supabase
				.from("playlist")
				.upsert(
					chunk.map((playlist) => ({
						account_id: accountId,
						spotify_id: playlist.spotify_id,
						name: playlist.name,
						description: playlist.description,
						snapshot_id: playlist.snapshot_id,
						is_public: playlist.is_public,
						song_count: playlist.song_count,
						is_target: playlist.is_target,
						image_url: playlist.image_url,
					})),
					{ onConflict: "account_id,spotify_id" },
				)
				.select(),
		),
	);
}

/**
 * Deletes a playlist by ID, scoped to the owning account.
 * Note: This cascades to playlist_song due to FK constraint.
 */
export function deletePlaylist(
	accountId: string,
	id: string,
): Promise<Result<null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase.from("playlist").delete().eq("id", id).eq("account_id", accountId),
	);
}

/**
 * Deletes multiple playlists by ID in a single statement, scoped to the
 * owning account. Replaces per-row deletes in sync flows.
 */
export async function deletePlaylists(
	accountId: string,
	ids: string[],
): Promise<Result<null, DbError>> {
	if (ids.length === 0) {
		return Result.ok(null);
	}
	const supabase = createAdminSupabaseClient();
	const result = await chunkedWrite(
		ids,
		(chunk) =>
			fromSupabaseMany(
				supabase
					.from("playlist")
					.delete()
					.eq("account_id", accountId)
					.in("id", chunk)
					.select(),
			),
		{ chunkSize: DB_IN_FILTER_CHUNK_SIZE, concurrency: 4 },
	);
	if (Result.isError(result)) {
		return Result.err(result.error);
	}
	return Result.ok(null);
}

/**
 * Sets whether a playlist is a target for auto-sorting, scoped to the owning
 * account. Returns the updated playlist.
 */
export function setPlaylistTarget(
	accountId: string,
	id: string,
	isTarget: boolean,
): Promise<Result<Playlist, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("playlist")
			.update({ is_target: isTarget })
			.eq("id", id)
			.eq("account_id", accountId)
			.select()
			.single(),
	);
}

/**
 * Replaces the target-playlist selection for an account in a fixed number of
 * statements (clear all, then set the chosen ones), instead of one update per
 * playlist. `targetIds` that don't belong to the account are ignored by the
 * account_id scope.
 */
export async function setPlaylistTargets(
	accountId: string,
	targetIds: string[],
): Promise<Result<null, DbError>> {
	const supabase = createAdminSupabaseClient();

	const clearResult = await fromSupabaseMany(
		supabase
			.from("playlist")
			.update({ is_target: false })
			.eq("account_id", accountId)
			.eq("is_target", true)
			.select(),
	);
	if (Result.isError(clearResult)) {
		return Result.err(clearResult.error);
	}

	if (targetIds.length > 0) {
		const setResult = await fromSupabaseMany(
			supabase
				.from("playlist")
				.update({ is_target: true })
				.eq("account_id", accountId)
				.in("id", targetIds)
				.select(),
		);
		if (Result.isError(setResult)) {
			return Result.err(setResult.error);
		}
	}

	return Result.ok(null);
}

/**
 * Updates acknowledged playlist metadata for a playlist identified by
 * (account_id, spotify_id).
 * Only the provided fields change; all other fields are preserved.
 */
export function updatePlaylistMetadata(
	accountId: string,
	spotifyId: string,
	metadata: {
		name?: string;
		description?: string | null;
		song_count?: number;
		image_url?: string | null;
	},
): Promise<Result<Playlist, DbError>> {
	const fields: Pick<
		TablesUpdate<"playlist">,
		"name" | "description" | "song_count" | "image_url"
	> = {};
	if (metadata.name !== undefined) fields.name = metadata.name;
	if (metadata.description !== undefined)
		fields.description = metadata.description;
	if (metadata.song_count !== undefined)
		fields.song_count = metadata.song_count;
	if (metadata.image_url !== undefined) fields.image_url = metadata.image_url;

	if (Object.keys(fields).length === 0) {
		return Promise.resolve(
			Result.err(
				new DatabaseError({
					code: "EMPTY_UPDATE",
					message: "No fields to update",
				}),
			),
		);
	}

	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("playlist")
			.update(fields)
			.eq("account_id", accountId)
			.eq("spotify_id", spotifyId)
			.select()
			.single(),
	);
}

/**
 * Writes sanitized genre_pills for a playlist identified by (account_id, id).
 * Ownership is enforced via account_id in the WHERE clause — the service-role
 * client bypasses RLS, so the account_id filter is the authorization boundary.
 */
export function updatePlaylistGenrePills(
	accountId: string,
	playlistId: string,
	pills: string[],
): Promise<Result<Playlist, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("playlist")
			.update({ genre_pills: pills })
			.eq("id", playlistId)
			.eq("account_id", accountId)
			.select()
			.single(),
	);
}

/**
 * Writes match_intent (our own, Spotify-decoupled intent text) for a playlist
 * identified by (account_id, id). Ownership is enforced via account_id in the
 * WHERE clause — the service-role client bypasses RLS, so the account_id filter
 * is the authorization boundary.
 */
export function updatePlaylistMatchIntent(
	accountId: string,
	playlistId: string,
	value: string | null,
): Promise<Result<Playlist, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("playlist")
			.update({ match_intent: value })
			.eq("id", playlistId)
			.eq("account_id", accountId)
			.select()
			.single(),
	);
}

/**
 * One statement covers all three fields so a handler crash mid-write cannot
 * leave match_intent and genre_pills updated while match_filters is still
 * stale (or vice versa). The caller must validate matchFilters into a
 * PlaylistMatchFiltersV1 before calling — the `as Json` cast below is forced
 * by the Supabase client API, not a bypass of that validation.
 */
export function updatePlaylistMatchConfig(
	accountId: string,
	playlistId: string,
	config: {
		matchIntent: string | null;
		genrePills: string[];
		matchFilters: PlaylistMatchFiltersV1;
	},
): Promise<Result<Playlist, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("playlist")
			.update({
				match_intent: config.matchIntent,
				genre_pills: config.genrePills,
				match_filters: config.matchFilters as Json,
			})
			.eq("id", playlistId)
			.eq("account_id", accountId)
			.select()
			.single(),
	);
}

export function updatePlaylistSongCount(
	accountId: string,
	playlistId: string,
	songCount: number,
): Promise<Result<null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("playlist")
			.update({ song_count: songCount })
			.eq("id", playlistId)
			.eq("account_id", accountId),
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
 * Paginated read of playlist songs using an offset cursor.
 *
 * We intentionally avoid keyset pagination on `position` because the schema
 * does not enforce `(playlist_id, position)` uniqueness. Using the row offset
 * keeps pagination correct even if duplicate positions slip into the table.
 */
export async function getPlaylistSongsPage(
	playlistId: string,
	options: { cursor?: number; limit: number },
): Promise<
	Result<{ items: PlaylistSong[]; nextCursor: number | null }, DbError>
> {
	const supabase = createAdminSupabaseClient();
	const pageLimit = options.limit + 1;
	const start = options.cursor ?? 0;

	const result = await fromSupabaseMany(
		supabase
			.from("playlist_song")
			.select("*")
			.eq("playlist_id", playlistId)
			.order("position", { ascending: true })
			.order("id", { ascending: true })
			.range(start, start + pageLimit - 1),
	);
	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	const rows = result.value;
	const hasMore = rows.length > options.limit;
	const items = hasMore ? rows.slice(0, options.limit) : rows;
	const nextCursor = hasMore ? start + items.length : null;

	return Result.ok({ items, nextCursor });
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
	return chunkedWrite(songs, (chunk) =>
		fromSupabaseMany(
			supabase
				.from("playlist_song")
				.upsert(
					chunk.map((song) => ({
						playlist_id: playlistId,
						song_id: song.song_id,
						position: song.position,
						added_at: song.added_at,
					})),
					{ onConflict: "playlist_id,song_id" },
				)
				.select(),
		),
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
	const result = await chunkedWrite(
		songIds,
		(chunk) =>
			fromSupabaseMany(
				supabase
					.from("playlist_song")
					.delete()
					.eq("playlist_id", playlistId)
					.in("song_id", chunk)
					.select(),
			),
		{ chunkSize: DB_IN_FILTER_CHUNK_SIZE, concurrency: 4 },
	);
	if (Result.isError(result)) {
		return Result.err(result.error);
	}
	return Result.ok(null);
}

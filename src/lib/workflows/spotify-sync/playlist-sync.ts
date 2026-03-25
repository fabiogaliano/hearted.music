/**
 * Playlist sync operations.
 *
 * Syncs pre-fetched playlist data (from extension Pathfinder API) to the database.
 */

import { Result } from "better-result";
import { z } from "zod";
import type {
	Playlist,
	PlaylistSong,
} from "@/lib/domains/library/playlists/queries";
import * as playlists from "@/lib/domains/library/playlists/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import { dedupeTracksBySpotifyId } from "./dedupe";
import type { DbError } from "@/lib/shared/errors/database";
import { SyncFailedError } from "@/lib/shared/errors/domain/sync";
import type { SpotifyPlaylistDTO, SpotifyTrackDTO } from "./types";
import { importSpotifyTracks } from "./sync-helpers";

/** Playlist change entry */
export const PlaylistChangeEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
});
export type PlaylistChangeEntry = z.infer<typeof PlaylistChangeEntrySchema>;

/** Playlist sync changes */
export const PlaylistSyncChangesSchema = z.object({
	created: z.array(PlaylistChangeEntrySchema),
	updated: z.array(PlaylistChangeEntrySchema),
	removed: z.array(PlaylistChangeEntrySchema),
});
export type PlaylistSyncChanges = z.infer<typeof PlaylistSyncChangesSchema>;

/** Result of syncing playlists */
export const PlaylistSyncResultSchema = z.object({
	total: z.number(),
	created: z.number(),
	updated: z.number(),
	removed: z.number(),
	removedTargetPlaylistIds: z.array(z.string()),
	updatedTargetPlaylistIds: z.array(z.string()),
	changes: PlaylistSyncChangesSchema,
});
export type PlaylistSyncResult = z.infer<typeof PlaylistSyncResultSchema>;

/** Added track entry */
export const AddedTrackEntrySchema = z.object({
	name: z.string(),
	artist: z.string(),
});
export type AddedTrackEntry = z.infer<typeof AddedTrackEntrySchema>;

/** Removed track entry */
export const RemovedTrackEntrySchema = z.object({
	id: z.string(),
});
export type RemovedTrackEntry = z.infer<typeof RemovedTrackEntrySchema>;

/** Result of syncing tracks for a playlist */
export const PlaylistTrackSyncResultSchema = z.object({
	playlistId: z.string(),
	playlistName: z.string(),
	added: z.number(),
	removed: z.number(),
	addedTracks: z.array(AddedTrackEntrySchema),
	removedTracks: z.array(RemovedTrackEntrySchema),
});
export type PlaylistTrackSyncResult = z.infer<
	typeof PlaylistTrackSyncResultSchema
>;

type PlaylistSyncError = DbError | SyncFailedError;

/** Options for syncPlaylists */
export interface SyncPlaylistsOptions {
	onProgress?: (count: number) => void;
	onTotalDiscovered?: (total: number) => void;
}

function playlistNeedsUpdate(
	existing: Playlist,
	spotify: SpotifyPlaylistDTO,
): boolean {
	return (
		existing.name !== spotify.name ||
		existing.description !== spotify.description ||
		(spotify.track_count !== null &&
			existing.song_count !== spotify.track_count) ||
		existing.image_url !== spotify.image_url
	);
}

/**
 * Syncs pre-fetched playlists to the database.
 * Creates new playlists, updates existing ones, removes deleted ones.
 */
export async function syncPlaylists(
	accountId: string,
	cachedPlaylists: SpotifyPlaylistDTO[],
	options: SyncPlaylistsOptions = {},
): Promise<Result<PlaylistSyncResult, PlaylistSyncError>> {
	const { onProgress, onTotalDiscovered } = options;

	onTotalDiscovered?.(cachedPlaylists.length);
	onProgress?.(cachedPlaylists.length);

	const existingResult = await playlists.getPlaylists(accountId);
	if (Result.isError(existingResult)) {
		return Result.err(existingResult.error);
	}
	const existingPlaylists = existingResult.value;
	const existingBySpotifyId = new Map(
		existingPlaylists.map((p: Playlist) => [p.spotify_id, p]),
	);

	const spotifyIds = new Set(
		cachedPlaylists.map((p: SpotifyPlaylistDTO) => p.id),
	);
	const toCreate: SpotifyPlaylistDTO[] = [];
	const toUpdate: SpotifyPlaylistDTO[] = [];
	const toRemove: Playlist[] = [];

	for (const sp of cachedPlaylists) {
		const existing = existingBySpotifyId.get(sp.id);
		if (!existing) {
			toCreate.push(sp);
		} else if (playlistNeedsUpdate(existing, sp)) {
			toUpdate.push(sp);
		}
	}

	for (const existing of existingPlaylists) {
		if (!spotifyIds.has(existing.spotify_id)) {
			toRemove.push(existing);
		}
	}

	const toUpsert = [...toCreate, ...toUpdate];
	if (toUpsert.length > 0) {
		const upsertData = toUpsert.map((sp: SpotifyPlaylistDTO) => ({
			spotify_id: sp.id,
			name: sp.name,
			description: sp.description,
			snapshot_id: null,
			is_public: true,
			song_count:
				sp.track_count ?? existingBySpotifyId.get(sp.id)?.song_count ?? 0,
			is_target: existingBySpotifyId.get(sp.id)?.is_target ?? false,
			image_url: sp.image_url,
		}));

		const upsertResult = await playlists.upsertPlaylists(accountId, upsertData);
		if (Result.isError(upsertResult)) {
			return Result.err(upsertResult.error);
		}
	}

	const removedTargetIds = toRemove.filter((p) => p.is_target).map((p) => p.id);

	const updatedTargetIds = toUpdate
		.map((sp) => existingBySpotifyId.get(sp.id))
		.filter((p): p is Playlist => p?.is_target === true)
		.map((p) => p.id);

	for (const playlist of toRemove) {
		const deleteResult = await playlists.deletePlaylist(playlist.id);
		if (Result.isError(deleteResult)) {
			return Result.err(deleteResult.error);
		}
	}

	const result: PlaylistSyncResult = {
		total: cachedPlaylists.length,
		created: toCreate.length,
		updated: toUpdate.length,
		removed: toRemove.length,
		removedTargetPlaylistIds: removedTargetIds,
		updatedTargetPlaylistIds: updatedTargetIds,
		changes: {
			created: toCreate.map((p: SpotifyPlaylistDTO) => ({
				id: p.id,
				name: p.name,
			})),
			updated: toUpdate.map((p: SpotifyPlaylistDTO) => ({
				id: p.id,
				name: p.name,
			})),
			removed: toRemove.map((p: Playlist) => ({ id: p.id, name: p.name })),
		},
	};

	return Result.ok(result);
}

/**
 * Syncs pre-fetched tracks for a playlist to database.
 */
export async function syncPlaylistTracksFromData(
	playlist: Playlist,
	rawTracks: SpotifyTrackDTO[],
): Promise<Result<PlaylistTrackSyncResult, PlaylistSyncError>> {
	const spotifyTracks = dedupeTracksBySpotifyId(rawTracks);

	const [existingResult, songMapResult] = await Promise.all([
		playlists.getPlaylistSongs(playlist.id),
		importSpotifyTracks(spotifyTracks),
	]);
	if (Result.isError(existingResult)) {
		return Result.err(existingResult.error);
	}
	if (Result.isError(songMapResult)) {
		return Result.err(songMapResult.error);
	}
	const existingSongs = existingResult.value;
	const existingBySongId = new Map(
		existingSongs.map((ps: PlaylistSong) => [ps.song_id, ps]),
	);

	const songBySpotifyId = songMapResult.value;
	const upsertedSongs = [...songBySpotifyId.values()];

	const spotifyTrackIds = new Set(
		spotifyTracks.map((t: SpotifyTrackDTO) => t.track.id),
	);
	const toAdd: Array<{
		song: Song;
		spotifyTrack: SpotifyTrackDTO;
		position: number;
	}> = [];
	const toUpdate: Array<{
		song: Song;
		position: number;
		addedAt: string | null;
	}> = [];
	const toRemove: PlaylistSong[] = [];

	spotifyTracks.forEach((st: SpotifyTrackDTO, index: number) => {
		const song = songBySpotifyId.get(st.track.id);
		if (!song) {
			return;
		}
		const existing = existingBySongId.get(song.id);
		if (!existing) {
			toAdd.push({ song, spotifyTrack: st, position: index });
			return;
		}
		if (existing.position !== index) {
			toUpdate.push({
				song,
				position: index,
				addedAt: existing.added_at,
			});
		}
	});

	for (const existing of existingSongs) {
		const song = upsertedSongs.find((s: Song) => s.id === existing.song_id);
		if (!song || !spotifyTrackIds.has(song.spotify_id)) {
			toRemove.push(existing);
		}
	}

	const upsertData = [
		...toAdd.map((item) => ({
			song_id: item.song.id,
			position: item.position,
			added_at: item.spotifyTrack.added_at,
		})),
		...toUpdate.map((item) => ({
			song_id: item.song.id,
			position: item.position,
			added_at: item.addedAt ?? null,
		})),
	];

	if (upsertData.length > 0) {
		const upsertResult = await playlists.upsertPlaylistSongs(
			playlist.id,
			upsertData,
		);
		if (Result.isError(upsertResult)) {
			return Result.err(upsertResult.error);
		}
	}

	if (toRemove.length > 0) {
		const removeResult = await playlists.removePlaylistSongs(
			playlist.id,
			toRemove.map((ps: PlaylistSong) => ps.song_id),
		);
		if (Result.isError(removeResult)) {
			return Result.err(removeResult.error);
		}
	}

	const countResult = await playlists.updatePlaylistSongCount(
		playlist.id,
		spotifyTracks.length,
	);
	if (Result.isError(countResult)) {
		return Result.err(countResult.error);
	}

	const result: PlaylistTrackSyncResult = {
		playlistId: playlist.id,
		playlistName: playlist.name,
		added: toAdd.length,
		removed: toRemove.length,
		addedTracks: toAdd.map((item) => ({
			name: item.song.name,
			artist: item.song.artists[0] ?? "Unknown",
		})),
		removedTracks: toRemove.map((ps: PlaylistSong) => ({ id: ps.song_id })),
	};

	return Result.ok(result);
}

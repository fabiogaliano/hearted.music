/**
 * PlaylistSyncService - Handles Spotify playlist sync operations.
 *
 * Responsibilities:
 * - Sync playlists from Spotify to database
 * - Sync playlist tracks from Spotify to database
 * - Create/update playlists on Spotify
 *
 * Uses:
 * - SpotifyService for Spotify API calls
 * - data/playlists.ts for database operations
 * - data/songs.ts for song operations
 */

import { Result } from "better-result";
import { z } from "zod";
import type { SpotifyService } from "@/lib/integrations/spotify/service";
import type {
	SpotifyPlaylistDTO,
	SpotifyTrackDTO,
} from "@/lib/integrations/spotify/service";
import { dedupeTracksBySpotifyId } from "@/lib/integrations/spotify/mappers";
import * as playlists from "@/lib/data/playlists";
import * as songs from "@/lib/data/song";
import type { DbError } from "@/lib/shared/errors/database";
import type { SpotifyError } from "@/lib/shared/errors/external/spotify";
import { SyncFailedError } from "@/lib/shared/errors/domain/sync";
import type { Playlist, PlaylistSong } from "@/lib/data/playlists";
import type { Song } from "@/lib/data/song";

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
	/** Total playlists processed */
	total: z.number(),
	/** New playlists created */
	created: z.number(),
	/** Existing playlists updated */
	updated: z.number(),
	/** Playlists that were removed from Spotify */
	removed: z.number(),
	/** Details of changes */
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
	/** Tracks added to playlist */
	added: z.number(),
	/** Tracks removed from playlist */
	removed: z.number(),
	/** Details of changes */
	addedTracks: z.array(AddedTrackEntrySchema),
	removedTracks: z.array(RemovedTrackEntrySchema),
});
export type PlaylistTrackSyncResult = z.infer<
	typeof PlaylistTrackSyncResultSchema
>;

type PlaylistSyncFailedError = DbError | SpotifyError | SyncFailedError;

/** Options for syncPlaylists */
export interface SyncPlaylistsOptions {
	/** Pre-fetched playlists from discovery phase (skips API call) */
	cachedPlaylists?: SpotifyPlaylistDTO[];
	/** Progress callback (called with count of playlists processed) */
	onProgress?: (count: number) => void;
	/** Total discovered callback (called when total is known) */
	onTotalDiscovered?: (total: number) => void;
}

export class PlaylistSyncService {
	constructor(private spotify: SpotifyService) {}

	/**
	 * Syncs all playlists from Spotify to database for an account.
	 * Creates new playlists, updates existing ones, marks removed ones.
	 *
	 * If cachedPlaylists is provided (from discovery phase), uses those
	 * directly without making any API calls - enabling zero-cost sync.
	 */
	async syncPlaylists(
		accountId: string,
		options: SyncPlaylistsOptions = {},
	): Promise<Result<PlaylistSyncResult, PlaylistSyncFailedError>> {
		const { cachedPlaylists, onProgress, onTotalDiscovered } = options;

		let spotifyPlaylists: SpotifyPlaylistDTO[];

		if (cachedPlaylists) {
			// Use cached playlists from discovery - ZERO API calls!
			spotifyPlaylists = cachedPlaylists;
			// Emit total immediately since we already know it
			onTotalDiscovered?.(cachedPlaylists.length);
			// Emit progress immediately since we have all data
			onProgress?.(cachedPlaylists.length);
		} else {
			// Fallback to fetching (for incremental sync use cases)
			const spotifyPlaylistsResult = await this.spotify.getPlaylists(
				onProgress,
				onTotalDiscovered,
			);

			if (Result.isError(spotifyPlaylistsResult)) {
				return Result.err(
					new SyncFailedError(
						"playlists",
						accountId,
						spotifyPlaylistsResult.error.message,
					),
				);
			}
			spotifyPlaylists = spotifyPlaylistsResult.value;
		}

		const existingResult = await playlists.getPlaylists(accountId);
		if (Result.isError(existingResult)) {
			return Result.err(existingResult.error);
		}
		const existingPlaylists = existingResult.value;
		const existingBySpotifyId = new Map(
			existingPlaylists.map((p: Playlist) => [p.spotify_id, p]),
		);

		const spotifyIds = new Set(
			spotifyPlaylists.map((p: SpotifyPlaylistDTO) => p.id),
		);
		const toCreate: SpotifyPlaylistDTO[] = [];
		const toUpdate: SpotifyPlaylistDTO[] = [];
		const toRemove: Playlist[] = [];

		for (const sp of spotifyPlaylists) {
			const existing = existingBySpotifyId.get(sp.id);
			if (!existing) {
				toCreate.push(sp);
			} else if (this.playlistNeedsUpdate(existing, sp)) {
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
				song_count: sp.track_count,
				is_destination: existingBySpotifyId.get(sp.id)?.is_destination ?? false,
				image_url: sp.image_url,
			}));

			const upsertResult = await playlists.upsertPlaylists(
				accountId,
				upsertData,
			);
			if (Result.isError(upsertResult)) {
				return Result.err(upsertResult.error);
			}
		}

		for (const playlist of toRemove) {
			const deleteResult = await playlists.deletePlaylist(playlist.id);
			if (Result.isError(deleteResult)) {
				return Result.err(deleteResult.error);
			}
		}

		const result: PlaylistSyncResult = {
			total: spotifyPlaylists.length,
			created: toCreate.length,
			updated: toUpdate.length,
			removed: toRemove.length,
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
	 * Syncs tracks for a specific playlist from Spotify to database.
	 * Adds new tracks, removes tracks no longer in playlist.
	 */
	async syncPlaylistTracks(
		accountId: string,
		playlist: Playlist,
	): Promise<Result<PlaylistTrackSyncResult, PlaylistSyncFailedError>> {
		const spotifyTracksResult = await this.spotify.getPlaylistTracks(
			playlist.spotify_id,
		);

		if (Result.isError(spotifyTracksResult)) {
			return Result.err(
				new SyncFailedError(
					"playlist_tracks",
					accountId,
					spotifyTracksResult.error.message,
				),
			);
		}

		// Dedupe at boundary: Spotify allows duplicates, we keep first occurrence only
		const spotifyTracks = dedupeTracksBySpotifyId(spotifyTracksResult.value);

		const existingResult = await playlists.getPlaylistSongs(playlist.id);
		if (Result.isError(existingResult)) {
			return Result.err(existingResult.error);
		}
		const existingSongs = existingResult.value;
		const existingBySongId = new Map(
			existingSongs.map((ps: PlaylistSong) => [ps.song_id, ps]),
		);

		const spotifyTrackData = spotifyTracks.map((t) => ({
			spotify_id: t.track.id,
			name: t.track.name,
			album_id: t.track.album.id,
			album_name: t.track.album.name,
			image_url: t.track.album.images[0]?.url ?? null,
			isrc: null,
			artists: t.track.artists.map((a: { id: string; name: string }) => a.name),
			duration_ms: t.track.duration_ms,
			genres: [],
			popularity: null,
			preview_url: null,
		}));

		const upsertedSongsResult = await songs.upsert(spotifyTrackData);
		if (Result.isError(upsertedSongsResult)) {
			return Result.err(upsertedSongsResult.error);
		}
		const upsertedSongs = upsertedSongsResult.value;

		// Build map of spotify_id -> song for lookup
		const songBySpotifyId = new Map(
			upsertedSongs.map((s: Song) => [s.spotify_id, s]),
		);

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

		// Find new tracks to add
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

		// Find tracks to remove (in DB but not in Spotify)
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

	/**
	 * Creates a new playlist on Spotify and saves to database.
	 */
	async createPlaylist(
		accountId: string,
		name: string,
		description: string,
	): Promise<Result<Playlist, PlaylistSyncFailedError>> {
		const spotifyResult = await this.spotify.createPlaylist(name, description);

		if (Result.isError(spotifyResult)) {
			return Result.err(
				new SyncFailedError(
					"playlists",
					accountId,
					spotifyResult.error.message,
				),
			);
		}

		const playlistData = [
			{
				spotify_id: spotifyResult.value.id,
				name: spotifyResult.value.name,
				description,
				snapshot_id: null,
				is_public: false,
				song_count: 0,
				is_destination: true,
			},
		];

		const upsertResult = await playlists.upsertPlaylists(
			accountId,
			playlistData,
		);
		if (Result.isError(upsertResult)) {
			return Result.err(upsertResult.error);
		}

		return Result.ok(upsertResult.value[0]);
	}

	/**
	 * Updates a playlist on Spotify.
	 */
	async updatePlaylist(
		accountId: string,
		playlistId: string,
		name: string,
		description: string,
	): Promise<Result<void, PlaylistSyncFailedError>> {
		const playlistResult = await playlists.getPlaylistById(playlistId);
		if (Result.isError(playlistResult)) {
			return Result.err(playlistResult.error);
		}

		if (playlistResult.value === null) {
			return Result.err(
				new SyncFailedError(
					"playlists",
					accountId,
					`Playlist ${playlistId} not found`,
				),
			);
		}
		const dbPlaylist = playlistResult.value;

		const spotifyResult = await this.spotify.updatePlaylist(
			dbPlaylist.spotify_id,
			name,
			description,
		);

		if (Result.isError(spotifyResult)) {
			return Result.err(
				new SyncFailedError(
					"playlists",
					accountId,
					spotifyResult.error.message,
				),
			);
		}

		const updateResult = await playlists.upsertPlaylists(accountId, [
			{
				spotify_id: dbPlaylist.spotify_id,
				name,
				description,
				snapshot_id: dbPlaylist.snapshot_id,
				is_public: dbPlaylist.is_public,
				song_count: dbPlaylist.song_count,
				is_destination: dbPlaylist.is_destination,
				image_url: dbPlaylist.image_url,
			},
		]);
		if (Result.isError(updateResult)) {
			return Result.err(updateResult.error);
		}

		return Result.ok(undefined);
	}

	/**
	 * Checks if a playlist needs to be updated based on Spotify data.
	 */
	private playlistNeedsUpdate(
		existing: Playlist,
		spotify: SpotifyPlaylistDTO,
	): boolean {
		return (
			existing.name !== spotify.name ||
			existing.description !== spotify.description ||
			existing.song_count !== spotify.track_count ||
			existing.image_url !== spotify.image_url
		);
	}
}

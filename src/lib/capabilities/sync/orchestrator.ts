/**
 * SyncOrchestrator - Coordinates all sync operations.
 *
 * Orchestrates:
 * - Liked songs sync from Spotify
 * - Playlist sync from Spotify
 * - Playlist tracks sync
 *
 * Uses:
 * - SpotifyService for Spotify API calls
 * - PlaylistSyncService for playlist operations
 * - data/songs.ts for song operations
 * - data/jobs.ts for job tracking
 */

import { Result } from "better-result";
import { z } from "zod";
import type {
	SpotifyService,
	SpotifyTrackDTO,
} from "../../integrations/spotify";
import {
	PlaylistSyncService,
	PlaylistSyncResultSchema,
	PlaylistTrackSyncResultSchema,
	type PlaylistSyncResult,
	type PlaylistTrackSyncResult,
} from "./playlist-sync";
import * as songs from "@/lib/data/song";
import * as likedSongs from "@/lib/data/liked-song";
import * as playlists from "@/lib/data/playlists";
import * as jobs from "@/lib/data/jobs";
import { completeJob, failJob, startJob } from "@/lib/jobs/lifecycle";
import {
	emitProgress,
	emitStatus,
	emitError,
	emitItem,
} from "@/lib/jobs/progress/helpers";
import type { DbError } from "@/lib/shared/errors/database";
import type { SpotifyError } from "@/lib/shared/errors/external/spotify";
import { SyncFailedError } from "@/lib/shared/errors/domain/sync";
import type { Song } from "@/lib/data/song";
import type { LikedSong } from "@/lib/data/liked-song";
import type { JobProgress } from "@/lib/data/jobs";
import type { Playlist } from "@/lib/data/playlists";

// ============================================================================
// Zod Schemas (single source of truth)
// ============================================================================

/** Result of syncing liked songs */
export const LikedSongsSyncResultSchema = z.object({
	/** Total tracks in Spotify library */
	total: z.number(),
	/** New tracks added */
	added: z.number(),
	/** Tracks removed (unliked) */
	removed: z.number(),
	/** Newly added songs with details */
	newSongs: z.custom<Song[]>(),
});
export type LikedSongsSyncResult = z.infer<typeof LikedSongsSyncResultSchema>;

/** Combined sync result for full sync */
export const FullSyncResultSchema = z.object({
	likedSongs: LikedSongsSyncResultSchema,
	playlists: PlaylistSyncResultSchema,
	playlistTracks: z.array(PlaylistTrackSyncResultSchema),
});
export type FullSyncResult = z.infer<typeof FullSyncResultSchema>;

/** Progress callback for sync operations */
export type SyncProgressCallback = (progress: JobProgress) => void;

/** All possible sync errors */
export type SyncOrchestratorError = DbError | SpotifyError | SyncFailedError;

// ============================================================================
// Service
// ============================================================================

export class SyncOrchestrator {
	private playlistSync: PlaylistSyncService;

	constructor(private spotify: SpotifyService) {
		this.playlistSync = new PlaylistSyncService(spotify);
	}

	/**
	 * Syncs liked/saved tracks from Spotify to database.
	 * Detects new tracks and removed (unliked) tracks.
	 */
	async syncLikedSongs(
		accountId: string,
		options: { since?: string | null } = {},
	): Promise<Result<LikedSongsSyncResult, SyncOrchestratorError>> {
		// 1. Fetch liked tracks from Spotify
		const spotifyTracksResult = await this.spotify.getLikedTracks(
			options.since,
		);

		if (Result.isError(spotifyTracksResult)) {
			return Result.err(
				new SyncFailedError(
					"liked_songs",
					accountId,
					spotifyTracksResult.error.message,
				),
			);
		}

		// Filter out unavailable tracks
		const spotifyTracks = spotifyTracksResult.value.filter(
			(t: SpotifyTrackDTO) => t.track != null,
		);
		const spotifyTrackIds = new Set(
			spotifyTracks.map((t: SpotifyTrackDTO) => t.track.id),
		);

		// 2. Get existing liked songs from database
		const existingResult = await likedSongs.getAll(accountId);
		if (Result.isError(existingResult)) {
			return Result.err(existingResult.error);
		}
		const existingLikedSongs = existingResult.value;

		// Get song details to map song_id -> spotify_id
		const existingSongIds = existingLikedSongs.map(
			(ls: LikedSong) => ls.song_id,
		);
		let existingSongs: Song[] = [];
		if (existingSongIds.length > 0) {
			// We need to get songs by ID to find their spotify_ids
			const songsResult = await songs.getByIds(
				existingSongIds.filter((id: string) => id.length > 0),
			);
			if (Result.isError(songsResult)) {
				return Result.err(songsResult.error);
			}
			existingSongs = songsResult.value;
		}

		// Build a map of spotify_id -> liked_song for existing
		const dbSpotifyIds = new Set(existingSongs.map((s: Song) => s.spotify_id));

		// 3. Find tracks to add (in Spotify but not in DB)
		const toAdd = spotifyTracks.filter(
			(st: SpotifyTrackDTO) => !dbSpotifyIds.has(st.track.id),
		);

		// 4. Find tracks to remove (in DB but not in Spotify)
		const toRemove = existingSongs.filter(
			(s: Song) => !spotifyTrackIds.has(s.spotify_id),
		);

		// 5. Upsert new songs to song table
		let newSongs: Song[] = [];
		if (toAdd.length > 0) {
			// Note: artists is stored as string[] of artist names in the database
			const songData = toAdd.map((st: SpotifyTrackDTO) => ({
				spotify_id: st.track.id,
				name: st.track.name,
				album_id: st.track.album.id,
				album_name: st.track.album.name,
				image_url: st.track.album.images[0]?.url ?? null,
				isrc: null,
				artists: st.track.artists.map(
					(a: { id: string; name: string }) => a.name,
				),
				duration_ms: st.track.duration_ms,
				genres: [],
				popularity: null,
				preview_url: null,
			}));

			const upsertedResult = await songs.upsert(songData);
			if (Result.isError(upsertedResult)) {
				return Result.err(upsertedResult.error);
			}
			newSongs = upsertedResult.value;

			// 6. Link to liked_song table
			const likedSongData = toAdd.map((st: SpotifyTrackDTO) => {
				const song = newSongs.find((s: Song) => s.spotify_id === st.track.id);
				return {
					song_id: song!.id,
					liked_at: st.added_at,
				};
			});

			const likedResult = await likedSongs.upsert(accountId, likedSongData);
			if (Result.isError(likedResult)) {
				return Result.err(likedResult.error);
			}
		}

		// 7. Soft delete removed tracks
		for (const track of toRemove) {
			const deleteResult = await likedSongs.softDelete(accountId, track.id);
			if (Result.isError(deleteResult)) {
				return Result.err(deleteResult.error);
			}
		}

		// 8. Build result
		const result: LikedSongsSyncResult = {
			total: spotifyTracks.length,
			added: toAdd.length,
			removed: toRemove.length,
			newSongs,
		};

		return Result.ok(result);
	}

	/**
	 * Syncs all playlists from Spotify to database.
	 */
	async syncPlaylists(
		accountId: string,
	): Promise<Result<PlaylistSyncResult, SyncOrchestratorError>> {
		const result = await this.playlistSync.syncPlaylists(accountId);
		// Re-wrap to unify error types
		if (Result.isError(result)) {
			return Result.err(result.error as SyncOrchestratorError);
		}
		return Result.ok(result.value);
	}

	/**
	 * Syncs tracks for specific playlists.
	 * If no playlistIds provided, syncs all destination playlists.
	 */
	async syncPlaylistTracks(
		accountId: string,
		playlistIds?: string[],
	): Promise<Result<PlaylistTrackSyncResult[], SyncOrchestratorError>> {
		// Determine which playlists to sync
		let playlistsToSync: Playlist[];

		if (playlistIds && playlistIds.length > 0) {
			// Sync specific playlists
			const allResult = await playlists.getPlaylists(accountId);
			if (Result.isError(allResult)) {
				return Result.err(allResult.error);
			}
			playlistsToSync = allResult.value.filter((p: Playlist) =>
				playlistIds.includes(p.id),
			);
		} else {
			// Sync all destination playlists
			const destResult = await playlists.getDestinationPlaylists(accountId);
			if (Result.isError(destResult)) {
				return Result.err(destResult.error);
			}
			playlistsToSync = destResult.value;
		}

		if (playlistsToSync.length === 0) {
			return Result.ok([]);
		}

		// Sync each playlist
		const results: PlaylistTrackSyncResult[] = [];

		for (const playlist of playlistsToSync) {
			const syncResult = await this.playlistSync.syncPlaylistTracks(
				accountId,
				playlist,
			);
			if (Result.isError(syncResult)) {
				return Result.err(syncResult.error as SyncOrchestratorError);
			}
			results.push(syncResult.value);
		}

		return Result.ok(results);
	}

	/**
	 * Performs a full sync: liked songs, playlists, and playlist tracks.
	 * Creates a job for tracking progress.
	 */
	async fullSync(
		accountId: string,
		onProgress?: SyncProgressCallback,
	): Promise<Result<FullSyncResult, SyncOrchestratorError>> {
		// 1. Create sync job (use sync_liked_songs as primary job type)
		const jobResult = await jobs.createJob(accountId, "sync_liked_songs");
		if (Result.isError(jobResult)) {
			return Result.err(jobResult.error);
		}
		const job = jobResult.value;

		const markRunningResult = await startJob(job.id);
		if (Result.isError(markRunningResult)) {
			return Result.err(markRunningResult.error);
		}

		// Emit SSE: job started
		emitStatus(job.id, "running");

		const progress: JobProgress = {
			total: 3, // liked songs, playlists, playlist tracks
			done: 0,
			succeeded: 0,
			failed: 0,
		};

		try {
			// 2. Sync liked songs
			emitItem(job.id, {
				itemId: "liked_songs",
				itemKind: "song",
				status: "in_progress",
				label: "Syncing liked songs",
				index: 0,
			});
			onProgress?.(progress);
			const likedSongsResult = await this.syncLikedSongs(accountId);
			if (Result.isError(likedSongsResult)) {
				emitItem(job.id, {
					itemId: "liked_songs",
					itemKind: "song",
					status: "failed",
					label: "Liked songs sync failed",
					index: 0,
				});
				emitError(job.id, likedSongsResult.error.message);
				emitStatus(job.id, "failed");
				await failJob(job.id, likedSongsResult.error.message);
				return Result.err(likedSongsResult.error);
			}
			progress.done++;
			progress.succeeded++;
			await jobs.updateJobProgress(job.id, progress);
			emitProgress(job.id, progress);
			emitItem(job.id, {
				itemId: "liked_songs",
				itemKind: "song",
				status: "succeeded",
				label: `Synced ${likedSongsResult.value.added} new songs`,
				index: 0,
			});
			onProgress?.(progress);

			// 3. Sync playlists
			emitItem(job.id, {
				itemId: "playlists",
				itemKind: "playlist",
				status: "in_progress",
				label: "Syncing playlists",
				index: 1,
			});
			const playlistsResult = await this.syncPlaylists(accountId);
			if (Result.isError(playlistsResult)) {
				emitItem(job.id, {
					itemId: "playlists",
					itemKind: "playlist",
					status: "failed",
					label: "Playlist sync failed",
					index: 1,
				});
				emitError(job.id, playlistsResult.error.message);
				emitStatus(job.id, "failed");
				await failJob(job.id, playlistsResult.error.message);
				return Result.err(playlistsResult.error);
			}
			progress.done++;
			progress.succeeded++;
			await jobs.updateJobProgress(job.id, progress);
			emitProgress(job.id, progress);
			emitItem(job.id, {
				itemId: "playlists",
				itemKind: "playlist",
				status: "succeeded",
				label: `Synced ${playlistsResult.value.created} playlists`,
				index: 1,
			});
			onProgress?.(progress);

			// 4. Sync playlist tracks for destination playlists
			emitItem(job.id, {
				itemId: "playlist_tracks",
				itemKind: "playlist",
				status: "in_progress",
				label: "Syncing playlist tracks",
				index: 2,
			});
			const playlistTracksResult = await this.syncPlaylistTracks(accountId);
			if (Result.isError(playlistTracksResult)) {
				emitItem(job.id, {
					itemId: "playlist_tracks",
					itemKind: "playlist",
					status: "failed",
					label: "Playlist tracks sync failed",
					index: 2,
				});
				emitError(job.id, playlistTracksResult.error.message);
				emitStatus(job.id, "failed");
				await failJob(job.id, playlistTracksResult.error.message);
				return Result.err(playlistTracksResult.error);
			}
			progress.done++;
			progress.succeeded++;
			await jobs.updateJobProgress(job.id, progress);
			emitProgress(job.id, progress);
			emitItem(job.id, {
				itemId: "playlist_tracks",
				itemKind: "playlist",
				status: "succeeded",
				label: `Synced ${playlistTracksResult.value.length} playlist tracks`,
				index: 2,
			});
			onProgress?.(progress);

			// 5. Mark job completed
			await completeJob(job.id);
			emitStatus(job.id, "completed");

			return Result.ok({
				likedSongs: likedSongsResult.value,
				playlists: playlistsResult.value,
				playlistTracks: playlistTracksResult.value,
			});
		} catch (error) {
			// Mark job failed
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			emitError(job.id, errorMessage);
			emitStatus(job.id, "failed");
			await failJob(job.id, errorMessage);
			throw error;
		}
	}

	/**
	 * Creates a new destination playlist.
	 */
	async createPlaylist(
		accountId: string,
		name: string,
		description: string,
	): Promise<Result<Playlist, SyncOrchestratorError>> {
		const result = await this.playlistSync.createPlaylist(
			accountId,
			name,
			description,
		);
		if (Result.isError(result)) {
			return Result.err(result.error as SyncOrchestratorError);
		}
		return Result.ok(result.value);
	}
}

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
import { SpotifyService } from "../../integrations/spotify/service";
import type {
	SpotifyTrackDTO,
	SpotifyPlaylistDTO,
} from "../../integrations/spotify/service";
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
import { completeJob, failJob, startJob } from "@/lib/jobs/lifecycle";
import { emitStatus, emitError, emitItem } from "@/lib/jobs/progress/helpers";
import type { DbError } from "@/lib/shared/errors/database";
import type { SpotifyError } from "@/lib/shared/errors/external/spotify";
import { SyncFailedError } from "@/lib/shared/errors/domain/sync";
import type { Song } from "@/lib/data/song";
import type { LikedSong } from "@/lib/data/liked-song";
import type { JobProgress } from "@/lib/data/jobs";
import type { Playlist } from "@/lib/data/playlists";
import type { PhaseJobIds } from "@/lib/jobs/progress/types";

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

/** Service-level progress callback (emits item counts) */
export type ServiceProgressCallback = (count: number) => void;

/** Service-level total callback (emits total discovered) */
export type ServiceTotalCallback = (total: number) => void;

/** Orchestrator-level progress callback (emits full JobProgress) */
export type SyncProgressCallback = (progress: JobProgress) => void;

/** All possible sync errors */
export type SyncOrchestratorError = DbError | SpotifyError | SyncFailedError;

/** Result of the discovery phase - all totals + cached playlists */
interface DiscoveryResult {
	songsTotal: number;
	playlistsTotal: number;
	tracksTotal: number;
	/** Cached playlists from discovery - reused in sync phase to avoid re-fetch */
	cachedPlaylists: SpotifyPlaylistDTO[];
}

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
		options: {
			since?: string | null;
			onProgress?: (count: number) => void;
			onTotalDiscovered?: (total: number) => void;
		} = {},
	): Promise<Result<LikedSongsSyncResult, SyncOrchestratorError>> {
		// 1. Fetch liked tracks from Spotify
		const spotifyTracksResult = await this.spotify.getLikedTracks(
			options.since,
			options.onProgress,
			options.onTotalDiscovered,
		);

		if (Result.isError(spotifyTracksResult)) {
			return Result.err(
				new SyncFailedError(
					"liked_songs",
					accountId,
					spotifyTracksResult.error.message,
					spotifyTracksResult.error,
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

		// ================================================================
		// ONBOARDING FAST PATH: Fresh user - just insert everything
		// ================================================================
		if (existingLikedSongs.length === 0) {
			const songData = spotifyTracks.map((st: SpotifyTrackDTO) => ({
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
			const newSongs = upsertedResult.value;

			// Link all to liked_song table
			const songMap = new Map(newSongs.map((s) => [s.spotify_id, s]));
			const likedSongData = spotifyTracks.flatMap((st: SpotifyTrackDTO) => {
				const song = songMap.get(st.track.id);
				return song ? [{ song_id: song.id, liked_at: st.added_at }] : [];
			});

			const likedResult = await likedSongs.upsert(accountId, likedSongData);
			if (Result.isError(likedResult)) {
				return Result.err(likedResult.error);
			}

			return Result.ok({
				total: spotifyTracks.length,
				added: spotifyTracks.length,
				removed: 0,
				newSongs,
			});
		}

		// ================================================================
		// INCREMENTAL SYNC: Compare and diff with existing data
		// ================================================================

		// Get song details to map song_id -> spotify_id
		const existingSongIds = existingLikedSongs.map(
			(ls: LikedSong) => ls.song_id,
		);
		const songsResult = await songs.getByIds(
			existingSongIds.filter((id: string) => id.length > 0),
		);
		if (Result.isError(songsResult)) {
			return Result.err(songsResult.error);
		}
		const existingSongs = songsResult.value;

		// Build a map of spotify_id -> liked_song for existing
		const dbSpotifyIds = new Set(existingSongs.map((s: Song) => s.spotify_id));

		// Find tracks to add (in Spotify but not in DB)
		const toAdd = spotifyTracks.filter(
			(st: SpotifyTrackDTO) => !dbSpotifyIds.has(st.track.id),
		);

		// Find tracks to remove (in DB but not in Spotify)
		const toRemove = existingSongs.filter(
			(s: Song) => !spotifyTrackIds.has(s.spotify_id),
		);

		// Upsert new songs to song table
		let newSongs: Song[] = [];
		if (toAdd.length > 0) {
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

			// Link to liked_song table
			const songMap = new Map(newSongs.map((s) => [s.spotify_id, s]));
			const likedSongData = toAdd.flatMap((st: SpotifyTrackDTO) => {
				const song = songMap.get(st.track.id);
				return song ? [{ song_id: song.id, liked_at: st.added_at }] : [];
			});

			const likedResult = await likedSongs.upsert(accountId, likedSongData);
			if (Result.isError(likedResult)) {
				return Result.err(likedResult.error);
			}
		}

		// Soft delete removed tracks
		if (toRemove.length > 0) {
			const deleteResult = await likedSongs.softDeleteBatch(
				accountId,
				toRemove.map((track) => track.id),
			);
			if (Result.isError(deleteResult)) {
				return Result.err(deleteResult.error);
			}
		}

		return Result.ok({
			total: spotifyTracks.length,
			added: toAdd.length,
			removed: toRemove.length,
			newSongs,
		});
	}

	/**
	 * Syncs all playlists from Spotify to database.
	 * If cachedPlaylists is provided (from discovery), skips API call.
	 */
	async syncPlaylists(
		accountId: string,
		options: {
			cachedPlaylists?: SpotifyPlaylistDTO[];
			onProgress?: (count: number) => void;
			onTotalDiscovered?: (total: number) => void;
		} = {},
	): Promise<Result<PlaylistSyncResult, SyncOrchestratorError>> {
		const result = await this.playlistSync.syncPlaylists(accountId, options);
		// Re-wrap to unify error types
		if (Result.isError(result)) {
			return Result.err(result.error as SyncOrchestratorError);
		}
		return Result.ok(result.value);
	}

	/**
	 * Syncs tracks for specific playlists.
	 * @param accountId - The account to sync
	 * @param playlistIds - Specific playlist IDs to sync, or undefined for default behavior
	 * @param options.syncAllPlaylists - If true, sync all playlists. If false, sync only destination playlists.
	 * @param options.onProgress - Progress callback with cumulative tracks processed
	 * @param options.onTotalDiscovered - Callback when total track count is known
	 */
	async syncPlaylistTracks(
		accountId: string,
		playlistIds?: string[],
		options?: {
			syncAllPlaylists?: boolean;
			onProgress?: (tracksProcessed: number) => void;
			onTotalDiscovered?: (totalTracks: number) => void;
		},
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
		} else if (options?.syncAllPlaylists) {
			// Sync all playlists (used during onboarding)
			const allResult = await playlists.getPlaylists(accountId);
			if (Result.isError(allResult)) {
				return Result.err(allResult.error);
			}
			playlistsToSync = allResult.value;
		} else {
			// Sync all destination playlists (default behavior)
			const destResult = await playlists.getDestinationPlaylists(accountId);
			if (Result.isError(destResult)) {
				return Result.err(destResult.error);
			}
			playlistsToSync = destResult.value;
		}

		if (playlistsToSync.length === 0) {
			return Result.ok([]);
		}

		// Calculate total tracks across all playlists
		const totalTracks = playlistsToSync.reduce(
			(sum, p) => sum + (p.song_count ?? 0),
			0,
		);
		options?.onTotalDiscovered?.(totalTracks);

		// Sync each playlist, tracking cumulative track count
		const results: PlaylistTrackSyncResult[] = [];
		let tracksProcessed = 0;

		for (const playlist of playlistsToSync) {
			const syncResult = await this.playlistSync.syncPlaylistTracks(
				accountId,
				playlist,
			);
			if (Result.isError(syncResult)) {
				return Result.err(syncResult.error as SyncOrchestratorError);
			}
			results.push(syncResult.value);

			// Emit cumulative tracks processed
			tracksProcessed += playlist.song_count ?? 0;
			options?.onProgress?.(tracksProcessed);
		}

		return Result.ok(results);
	}

	/**
	 * Runs a single sync phase with job lifecycle management.
	 * Handles job start, execution, and completion/failure.
	 */
	private async runPhase<T>(
		jobId: string,
		syncFn: () => Promise<Result<T, SyncOrchestratorError>>,
	): Promise<Result<T, SyncOrchestratorError>> {
		const startResult = await startJob(jobId);
		if (Result.isError(startResult)) {
			return Result.err(startResult.error);
		}

		const result = await syncFn();

		if (Result.isError(result)) {
			emitError(jobId, result.error.message);
			emitStatus(jobId, "failed");
			await failJob(jobId, result.error.message);
			return result;
		}

		emitStatus(jobId, "completed");
		await completeJob(jobId);
		return result;
	}

	/**
	 * Discovery phase: fetches all totals BEFORE sync starts.
	 * Uses Promise.all for parallel fetching to eliminate waterfalls.
	 */
	private async discoverTotals(
		accountId: string,
	): Promise<Result<DiscoveryResult, SyncOrchestratorError>> {
		// PARALLEL FETCH: Playlists + songs count at the same time
		const [playlistsResult, songsCountResult] = await Promise.all([
			this.spotify.getPlaylists(),
			this.spotify.getLikedSongsCount(),
		]);

		// Handle errors (use full_sync as discovery is part of full sync)
		if (Result.isError(playlistsResult)) {
			return Result.err(
				new SyncFailedError(
					"full_sync",
					accountId,
					`Discovery failed: ${playlistsResult.error.message}`,
					playlistsResult.error,
				),
			);
		}
		if (Result.isError(songsCountResult)) {
			return Result.err(
				new SyncFailedError(
					"full_sync",
					accountId,
					`Discovery failed: ${songsCountResult.error.message}`,
					songsCountResult.error,
				),
			);
		}

		const playlists = playlistsResult.value;

		// Calculate totals from playlists (no API call - data already available)
		const playlistsTotal = playlists.length;
		const tracksTotal = playlists.reduce(
			(sum, p) => sum + (p.track_count ?? 0),
			0,
		);

		return Result.ok({
			songsTotal: songsCountResult.value,
			playlistsTotal,
			tracksTotal,
			cachedPlaylists: playlists,
		});
	}

	/**
	 * Syncs all three phases with discovery-first approach.
	 * Discovery fetches all totals before sync for accurate progress.
	 * Phase order: Playlists (cached) → Playlist Tracks → Liked Songs
	 *
	 * @param accountId - The account to sync
	 * @param phaseJobIds - Job IDs for each sync phase
	 */
	async fullSync(
		accountId: string,
		phaseJobIds: PhaseJobIds,
	): Promise<Result<FullSyncResult, SyncOrchestratorError>> {
		try {
			// ================================================================
			// DISCOVERY: Get all totals before sync (parallel fetch)
			// ================================================================
			const discoveryResult = await this.discoverTotals(accountId);
			if (Result.isError(discoveryResult)) {
				// Fail all jobs if discovery fails
				await Promise.all(
					Object.values(phaseJobIds).map(async (jobId) => {
						emitError(jobId, discoveryResult.error.message);
						emitStatus(jobId, "failed");
						await failJob(jobId, discoveryResult.error.message);
					}),
				);
				return discoveryResult;
			}

			const { songsTotal, playlistsTotal, tracksTotal, cachedPlaylists } =
				discoveryResult.value;

			// Emit all totals at once with explicit total field
			emitItem(phaseJobIds.liked_songs, {
				itemId: "liked_songs",
				itemKind: "song",
				status: "in_progress",
				count: 0,
				total: songsTotal,
			});
			emitItem(phaseJobIds.playlists, {
				itemId: "playlists",
				itemKind: "playlist",
				status: "in_progress",
				count: 0,
				total: playlistsTotal,
			});
			emitItem(phaseJobIds.playlist_tracks, {
				itemId: "playlist_tracks",
				itemKind: "song",
				status: "in_progress",
				count: 0,
				total: tracksTotal,
			});

			// ================================================================
			// PHASE 1: Playlists (cached from discovery - ZERO API calls!)
			// ================================================================
			const playlistsResult = await this.runPhase(phaseJobIds.playlists, () =>
				this.syncPlaylists(accountId, {
					cachedPlaylists,
					onProgress: (count) => {
						emitItem(phaseJobIds.playlists, {
							itemId: "playlists",
							itemKind: "playlist",
							status: "in_progress",
							count,
						});
					},
				}),
			);
			if (Result.isError(playlistsResult)) return playlistsResult;

			// ================================================================
			// PHASE 2: Playlist Tracks (bulk of the work)
			// ================================================================
			const tracksResult = await this.runPhase(
				phaseJobIds.playlist_tracks,
				() =>
					this.syncPlaylistTracks(accountId, undefined, {
						syncAllPlaylists: true,
						onProgress: (count) => {
							emitItem(phaseJobIds.playlist_tracks, {
								itemId: "playlist_tracks",
								itemKind: "song",
								status: "in_progress",
								count,
							});
						},
					}),
			);
			if (Result.isError(tracksResult)) return tracksResult;

			// ================================================================
			// PHASE 3: Liked Songs (last)
			// ================================================================
			const songsResult = await this.runPhase(phaseJobIds.liked_songs, () =>
				this.syncLikedSongs(accountId, {
					onProgress: (count) => {
						emitItem(phaseJobIds.liked_songs, {
							itemId: "liked_songs",
							itemKind: "song",
							status: "in_progress",
							count,
						});
					},
				}),
			);
			if (Result.isError(songsResult)) return songsResult;

			return Result.ok({
				likedSongs: songsResult.value,
				playlists: playlistsResult.value,
				playlistTracks: tracksResult.value,
			});
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			return Result.err(
				new SyncFailedError("full_sync", accountId, errorMessage, error),
			);
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

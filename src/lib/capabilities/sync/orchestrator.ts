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
import type { SpotifyService } from "../../integrations/spotify/service";
import type { SpotifyPlaylistDTO } from "../../integrations/spotify/service";
import {
	PlaylistSyncService,
	PlaylistSyncResultSchema,
	PlaylistTrackSyncResultSchema,
	type PlaylistSyncResult,
	type PlaylistTrackSyncResult,
} from "./playlist-sync";

import * as playlists from "@/lib/data/playlists";
import { emitItem } from "@/lib/jobs/progress/helpers";
import {
	fetchLikedSongs,
	initialSync,
	incrementalSync,
	runPhase,
} from "./sync-helpers";
import type { DbError } from "@/lib/shared/errors/database";
import type { SpotifyError } from "@/lib/shared/errors/external/spotify";
import { SyncFailedError } from "@/lib/shared/errors/domain/sync";
import type { Song } from "@/lib/data/song";
import type { JobProgress } from "@/lib/data/jobs";
import type { Playlist } from "@/lib/data/playlists";
import type { PhaseJobIds } from "@/lib/jobs/progress/types";
import * as likedSongData from "@/lib/data/liked-song";

export class SyncOrchestrator {
	private playlistSync: PlaylistSyncService;

	constructor(private spotify: SpotifyService) {
		this.playlistSync = new PlaylistSyncService(spotify);
	}

	async syncLikedSongs(
		accountId: string,
		options: {
			isInitialSync?: boolean;
			since?: string | null;
			onProgress?: (count: number) => void;
			onTotalDiscovered?: (total: number) => void;
		} = {},
	): Promise<Result<LikedSongsSyncResult, SyncOrchestratorError>> {
		const spotifyResult = await fetchLikedSongs(
			this.spotify,
			accountId,
			options,
		);
		if (Result.isError(spotifyResult)) {
			return spotifyResult;
		}
		const { likedSongs, likedSongsIds } = spotifyResult.value;

		if (options.isInitialSync) {
			return initialSync(accountId, likedSongs);
		}

		const existingResult = await likedSongData.getAll(accountId);
		if (Result.isError(existingResult)) {
			return existingResult;
		}

		return incrementalSync(accountId, {
			likedSongs,
			existingLikedSongs: existingResult.value,
			likedSongsIds,
		});
	}

	/**
	 * Syncs all playlists from Spotify to database.
	 * If cachedPlaylists is provided (from summary), skips API call.
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
	 * Discovery phase: fetches all totals BEFORE sync starts.
	 * Uses Promise.all for parallel fetching to eliminate waterfalls.
	 *
	 * This is the first step of a two-phase sync:
	 * 1. getLibrarySummary() - Get totals + cache playlists (called from ConnectingStep)
	 * 2. execute() - Run sync phases with known totals (called from SyncingStep)
	 */
	async getLibrarySummary(
		accountId: string,
	): Promise<Result<LibrarySummary, SyncOrchestratorError>> {
		// PARALLEL FETCH: Playlists + songs count at the same time
		const [playlistsResult, songsCountResult] = await Promise.all([
			this.spotify.getPlaylists(),
			this.spotify.getLikedSongsCount(),
		]);

		// Handle errors
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
	 * Execute sync phases.
	 *
	 * Can be called two ways:
	 * 1. With librarySummary (onboarding): Totals emitted upfront, cached playlists reused
	 * 2. Without librarySummary (in-app sync): Fetches fresh, progress updates as items processed
	 *
	 * Phase order: Playlists → Playlist Tracks → Liked Songs
	 */
	async execute(
		accountId: string,
		phaseJobIds: PhaseJobIds,
		librarySummary?: LibrarySummary,
	): Promise<Result<FullSyncResult, SyncOrchestratorError>> {
		try {
			// If we have a summary, emit totals upfront for immediate progress display
			if (librarySummary) {
				const { songsTotal, playlistsTotal, tracksTotal } = librarySummary;
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
			}

			// ================================================================
			// PHASE 1: Playlists (uses cache if available)
			// ================================================================
			const playlistsResult = await runPhase(phaseJobIds.playlists, () =>
				this.syncPlaylists(accountId, {
					cachedPlaylists: librarySummary?.cachedPlaylists,
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
			const tracksResult = await runPhase(phaseJobIds.playlist_tracks, () =>
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
			const songsResult = await runPhase(phaseJobIds.liked_songs, () =>
				this.syncLikedSongs(accountId, {
					isInitialSync: !!librarySummary,
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
}

/** Result of syncing liked songs */
export const LikedSongsSyncResultSchema = z.object({
	total: z.number(),
	added: z.number(),
	removed: z.number(),
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

export type ServiceProgressCallback = (count: number) => void;
export type ServiceTotalCallback = (total: number) => void;
export type SyncProgressCallback = (progress: JobProgress) => void;
export type SyncOrchestratorError = DbError | SpotifyError | SyncFailedError;

/** Zod schema for SpotifyPlaylistDTO (matches the interface in spotify/service.ts) */
export const SpotifyPlaylistDTOSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	owner: z.object({ id: z.string() }),
	track_count: z.number(),
	image_url: z.string().nullable(),
});

/**
 * Summary of user's Spotify library - totals + cached playlists.
 * Fetched once in ConnectingStep, passed to SyncingStep for execution.
 * Cached playlists avoid duplicate API calls during sync.
 *
 * INVARIANT: cachedPlaylists.length === playlistsTotal (fetched atomically)
 */
export const LibrarySummarySchema = z.object({
	songsTotal: z.number(),
	playlistsTotal: z.number(),
	tracksTotal: z.number(),
	/** Playlists fetched during summary - reused in sync to avoid duplicate API call */
	cachedPlaylists: z.array(SpotifyPlaylistDTOSchema),
});
export type LibrarySummary = z.infer<typeof LibrarySummarySchema>;

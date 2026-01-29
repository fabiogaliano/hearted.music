/**
 * Sync Helpers - Pure functions for sync operations.
 *
 * These are stateless functions extracted from SyncOrchestrator
 * to improve testability and reduce class complexity.
 */

import { Result } from "better-result";
import {
	type SpotifyTrackDTO,
	type SpotifyService,
} from "../../integrations/spotify/service";
import * as songs from "@/lib/data/song";
import * as likedSongsData from "@/lib/data/liked-song";
import { completeJob, failJob, startJob } from "@/lib/jobs/lifecycle";
import { emitStatus, emitError } from "@/lib/jobs/progress/helpers";
import type { Song } from "@/lib/data/song";
import type { LikedSong } from "@/lib/data/liked-song";
import type { DbError } from "@/lib/shared/errors/database";
import type { SpotifyError } from "@/lib/shared/errors/external/spotify";
import { SyncFailedError } from "@/lib/shared/errors/domain/sync";
import type { LikedSongsSyncResult } from "./orchestrator";

/** Errors that can occur during sync operations (infrastructure + domain) */
type SyncOperationError = DbError | SpotifyError | SyncFailedError;

/**
 * Fetches liked tracks from Spotify API and filters out unavailable tracks.
 * Returns both the filtered tracks and a Set of their Spotify IDs for efficient lookup.
 */
export async function fetchLikedSongs(
	spotify: SpotifyService,
	accountId: string,
	options: {
		since?: string | null;
		onProgress?: (count: number) => void;
		onTotalDiscovered?: (total: number) => void;
	},
): Promise<Result<{ likedSongs: SpotifyTrackDTO[]; likedSongsIds: Set<string> }, SyncOperationError>> {
	const likedSongsResult = await spotify.getLikedTracks(
		options.since,
		options.onProgress,
		options.onTotalDiscovered,
	);

	if (Result.isError(likedSongsResult)) {
		return Result.err(
			new SyncFailedError(
				"liked_songs",
				accountId,
				likedSongsResult.error.message,
				likedSongsResult.error,
			),
		);
	}

	// Spotify returns null for tracks removed from catalog (licensing, artist request)
	const likedSongs = likedSongsResult.value.filter(
		(t: SpotifyTrackDTO) => t.track != null,
	);
	const likedSongsIds = new Set(
		likedSongs.map((t: SpotifyTrackDTO) => t.track.id),
	);

	return Result.ok({ likedSongs, likedSongsIds });
}

/**
 * Transforms a SpotifyTrackDTO to the format expected by songs.upsert().
 * Pure function - no side effects.
 */
export function mapSpotifyTrackToSongData(st: SpotifyTrackDTO) {
	return {
		spotify_id: st.track.id,
		name: st.track.name,
		album_id: st.track.album.id,
		album_name: st.track.album.name,
		image_url: st.track.album.images[0]?.url ?? null,
		isrc: null,
		artists: st.track.artists.map((a: { id: string; name: string }) => a.name),
		duration_ms: st.track.duration_ms,
		genres: [],
		popularity: null,
		preview_url: null,
	};
}

/**
 * Imports tracks into a user's liked songs.
 * Handles both the global song catalog and user-specific linking.
 *
 * Flow: Transform → Upsert to global catalog → Link to user's liked_songs
 *
 * Why two tables? Songs are shared across users (global catalog),
 * but liked_songs is per-user (tracks which songs a user has liked).
 */
export async function importLikedTracks(
	accountId: string,
	tracks: SpotifyTrackDTO[],
): Promise<Result<Song[], SyncOperationError>> {
	const songData = tracks.map(mapSpotifyTrackToSongData);

	const upsertedResult = await songs.upsert(songData);
	if (Result.isError(upsertedResult)) {
		return Result.err(upsertedResult.error);
	}
	const newSongs = upsertedResult.value;

	const songMap = new Map(newSongs.map((s) => [s.spotify_id, s]));
	const likedSongData = tracks.flatMap((st: SpotifyTrackDTO) => {
		const song = songMap.get(st.track.id);
		return song ? [{ song_id: song.id, liked_at: st.added_at }] : [];
	});

	const likedResult = await likedSongsData.upsert(accountId, likedSongData);
	if (Result.isError(likedResult)) {
		return Result.err(likedResult.error);
	}

	return Result.ok(newSongs);
}

/**
 * Initial sync for new users with no existing liked songs.
 * Imports all tracks as new - no diff calculation needed.
 */
export async function initialSync(
	accountId: string,
	spotifyTracks: SpotifyTrackDTO[],
): Promise<Result<LikedSongsSyncResult, SyncOperationError>> {
	const result = await importLikedTracks(accountId, spotifyTracks);
	if (Result.isError(result)) {
		return result;
	}

	return Result.ok({
		total: spotifyTracks.length,
		added: spotifyTracks.length,
		removed: 0,
		newSongs: result.value,
	});
}

/**
 * Incremental sync for existing users.
 * Compares Spotify state with database, adds new tracks, removes unliked.
 */
export async function incrementalSync(
	accountId: string,
	data: {
		likedSongs: SpotifyTrackDTO[];
		existingLikedSongs: LikedSong[];
		likedSongsIds: Set<string>;
	},
): Promise<Result<LikedSongsSyncResult, SyncOperationError>> {
	const { likedSongs, existingLikedSongs, likedSongsIds } = data;
	const existingSongIds = existingLikedSongs.map((ls: LikedSong) => ls.song_id);
	const songsResult = await songs.getByIds(
		existingSongIds.filter((id: string) => id.length > 0),
	);
	if (Result.isError(songsResult)) {
		return Result.err(songsResult.error);
	}
	const existingSongs = songsResult.value;

	const dbSpotifyIds = new Set(existingSongs.map((s: Song) => s.spotify_id));
	const toAdd = likedSongs.filter(
		(st: SpotifyTrackDTO) => !dbSpotifyIds.has(st.track.id),
	);
	const toRemove = existingSongs.filter(
		(s: Song) => !likedSongsIds.has(s.spotify_id),
	);

	let newSongs: Song[] = [];
	if (toAdd.length > 0) {
		const result = await importLikedTracks(accountId, toAdd);
		if (Result.isError(result)) {
			return result;
		}
		newSongs = result.value;
	}

	if (toRemove.length > 0) {
		const deleteResult = await likedSongsData.softDeleteBatch(
			accountId,
			toRemove.map((track) => track.id),
		);
		if (Result.isError(deleteResult)) {
			return Result.err(deleteResult.error);
		}
	}

	return Result.ok({
		total: likedSongs.length,
		added: toAdd.length,
		removed: toRemove.length,
		newSongs,
	});
}

/**
 * Runs a sync operation with job lifecycle management.
 * Handles job start, execution, and completion/failure.
 *
 * @param jobId - The job ID for progress tracking
 * @param syncFn - The sync operation to execute
 */
export async function runPhase<T>(
	jobId: string,
	syncFn: () => Promise<Result<T, SyncOperationError>>,
): Promise<Result<T, SyncOperationError>> {
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

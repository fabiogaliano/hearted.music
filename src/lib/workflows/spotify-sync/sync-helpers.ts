/**
 * Sync helpers — stateless functions for sync operations.
 */

import { Result } from "better-result";
import * as artists from "@/lib/domains/library/artists/queries";
import type { LikedSong } from "@/lib/domains/library/liked-songs/queries";
import * as likedSongsData from "@/lib/domains/library/liked-songs/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import * as songs from "@/lib/domains/library/songs/queries";
import { completeJob, failJob, startJob } from "@/lib/platform/jobs/lifecycle";
import type { DbError } from "@/lib/shared/errors/database";
import { SyncFailedError } from "@/lib/shared/errors/domain/sync";
import type { LikedSongsSyncResult, SpotifyTrackDTO } from "./types";

type SyncOperationError = DbError | SyncFailedError;

/**
 * Transforms a SpotifyTrackDTO to catalog metadata for song upsert.
 * Does not include enrichment-owned fields (genres).
 */
export function mapSpotifyTrackToSongData(st: SpotifyTrackDTO) {
	return {
		spotify_id: st.track.id,
		name: st.track.name,
		album_id: st.track.album.id,
		album_name: st.track.album.name,
		image_url: st.track.album.images[0]?.url ?? null,
		isrc: null,
		artists: st.track.artists.map((a) => a.name),
		artist_ids: st.track.artists.map((a) => a.id),
		duration_ms: st.track.duration_ms,
		popularity: null,
		preview_url: null,
	};
}

/**
 * Shared import path for Spotify tracks used by both liked-song and playlist-track sync.
 * Maps tracks → catalog upsert (no genre overwrite) → persist artist metadata → return spotify_id→Song map.
 */
export async function importSpotifyTracks(
	tracks: SpotifyTrackDTO[],
): Promise<Result<Map<string, Song>, SyncOperationError>> {
	const songData = tracks.map(mapSpotifyTrackToSongData);

	const upsertedResult = await songs.upsertCatalog(songData);
	if (Result.isError(upsertedResult)) {
		return Result.err(upsertedResult.error);
	}

	const artistData = collectArtistUpsertData(tracks);
	if (artistData.length > 0) {
		const artistResult = await artists.upsert(artistData);
		if (Result.isError(artistResult)) {
			console.warn("Artist upsert failed:", artistResult.error.message);
		}
	}

	const songMap = new Map(upsertedResult.value.map((s) => [s.spotify_id, s]));
	return Result.ok(songMap);
}

/**
 * Extracts unique artist metadata from extension-provided track payloads.
 * Prefers the first non-null image URL when the same artist appears multiple times.
 */
function collectArtistUpsertData(
	tracks: SpotifyTrackDTO[],
): artists.ArtistUpsertData[] {
	const uniqueArtists = new Map<string, artists.ArtistUpsertData>();

	for (const st of tracks) {
		for (const a of st.track.artists) {
			const existing = uniqueArtists.get(a.id);
			if (!existing) {
				uniqueArtists.set(a.id, {
					spotify_id: a.id,
					name: a.name,
					image_url: a.imageUrl ?? null,
				});
				continue;
			}

			if (existing.image_url == null && a.imageUrl != null) {
				existing.image_url = a.imageUrl;
			}
		}
	}

	return [...uniqueArtists.values()];
}

/**
 * Imports tracks into a user's liked songs.
 * Uses the shared import path for catalog upsert + artist metadata persistence,
 * then links songs to the user's liked_songs.
 */
export async function importLikedTracks(
	accountId: string,
	tracks: SpotifyTrackDTO[],
): Promise<Result<Song[], SyncOperationError>> {
	const songMapResult = await importSpotifyTracks(tracks);
	if (Result.isError(songMapResult)) {
		return Result.err(songMapResult.error);
	}
	const songMap = songMapResult.value;

	const likedSongData = tracks.flatMap((st: SpotifyTrackDTO) => {
		const song = songMap.get(st.track.id);
		return song ? [{ song_id: song.id, liked_at: st.added_at }] : [];
	});

	const likedResult = await likedSongsData.upsert(accountId, likedSongData);
	if (Result.isError(likedResult)) {
		return Result.err(likedResult.error);
	}

	return Result.ok([...songMap.values()]);
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
		await failJob(jobId, result.error.message);
		return result;
	}

	await completeJob(jobId);
	return result;
}

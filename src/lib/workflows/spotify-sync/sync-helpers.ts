/**
 * Sync Helpers - Pure functions for sync operations.
 *
 * These are stateless functions extracted from SyncOrchestrator
 * to improve testability and reduce class complexity.
 */

import { Result } from "better-result";
import { z } from "zod";
import type { LikedSong } from "@/lib/domains/library/liked-songs/queries";
import * as likedSongsData from "@/lib/domains/library/liked-songs/queries";
import * as artists from "@/lib/domains/library/artists/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import * as songs from "@/lib/domains/library/songs/queries";
import { appFetch } from "@/lib/integrations/spotify/app-auth";
import { completeJob, failJob, startJob } from "@/lib/platform/jobs/lifecycle";
import { emitError, emitStatus } from "@/lib/platform/jobs/progress/helpers";
import type { DbError } from "@/lib/shared/errors/database";
import { SyncFailedError } from "@/lib/shared/errors/domain/sync";
import type { SpotifyError } from "@/lib/shared/errors/external/spotify";
import type {
	SpotifyService,
	SpotifyTrackDTO,
} from "../../integrations/spotify/service";
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
): Promise<
	Result<
		{ likedSongs: SpotifyTrackDTO[]; likedSongsIds: Set<string> },
		SyncOperationError
	>
> {
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
		artists: st.track.artists.map((a: { id: string; name: string }) => a.name),
		artist_ids: st.track.artists.map((a: { id: string; name: string }) => a.id),
		duration_ms: st.track.duration_ms,
		popularity: null,
		preview_url: null,
	};
}

/**
 * Shared import path for Spotify tracks used by both liked-song and playlist-track sync.
 * Maps tracks → catalog upsert (no genre overwrite) → sync artists → return spotify_id→Song map.
 */
export async function importSpotifyTracks(
	tracks: SpotifyTrackDTO[],
): Promise<Result<Map<string, Song>, SyncOperationError>> {
	const songData = tracks.map(mapSpotifyTrackToSongData);

	const upsertedResult = await songs.upsertCatalog(songData);
	if (Result.isError(upsertedResult)) {
		return Result.err(upsertedResult.error);
	}

	// Best-effort artist image sync
	syncArtists(tracks).catch((err) => console.warn("Artist sync failed:", err));

	const songMap = new Map(upsertedResult.value.map((s) => [s.spotify_id, s]));
	return Result.ok(songMap);
}

const SpotifyArtistsSchema = z.object({
	artists: z.array(
		z
			.object({
				id: z.string(),
				name: z.string(),
				images: z.array(z.object({ url: z.string() })),
			})
			.nullable(),
	),
});

/**
 * Fetches artist images from Spotify and upserts to the artist table.
 * Batches in groups of 50 (Spotify API limit).
 * Best-effort: logs warnings but doesn't fail the sync.
 */
async function syncArtists(tracks: SpotifyTrackDTO[]): Promise<void> {
	const uniqueArtists = new Map<string, string>();
	for (const st of tracks) {
		for (const a of st.track.artists) {
			if (!uniqueArtists.has(a.id)) {
				uniqueArtists.set(a.id, a.name);
			}
		}
	}

	if (uniqueArtists.size === 0) return;

	const artistIds = [...uniqueArtists.keys()];
	const BATCH_SIZE = 50;

	for (let i = 0; i < artistIds.length; i += BATCH_SIZE) {
		const batch = artistIds.slice(i, i + BATCH_SIZE);
		const result = await appFetch(
			`/artists?ids=${batch.join(",")}`,
			SpotifyArtistsSchema,
		);

		if (Result.isError(result)) {
			console.warn(
				"Failed to fetch artist images batch:",
				result.error.message,
			);
			continue;
		}

		const artistData = result.value.artists.filter(Boolean).map((a) => ({
			spotify_id: a!.id,
			name: a!.name,
			image_url: a!.images[0]?.url ?? null,
		}));

		const upsertResult = await artists.upsert(artistData);
		if (Result.isError(upsertResult)) {
			console.warn("Failed to upsert artists:", upsertResult.error.message);
		}
	}
}

/**
 * Imports tracks into a user's liked songs.
 * Uses the shared import path for catalog upsert + artist sync,
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
		emitError(jobId, result.error.message);
		emitStatus(jobId, "failed");
		await failJob(jobId, result.error.message);
		return result;
	}

	emitStatus(jobId, "completed");
	await completeJob(jobId);
	return result;
}

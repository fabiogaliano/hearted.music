/**
 * Sync helpers — stateless functions for sync operations.
 */

import { Result } from "better-result";
import type { z } from "zod";
import type { Json } from "@/lib/data/database.types";
import {
	type ArtistUpsertData,
	upsert as upsertArtists,
} from "@/lib/domains/library/artists/queries";
import type { LikedSongRef } from "@/lib/domains/library/liked-songs/queries";
import {
	softDeleteBatch as softDeleteLikedSongs,
	upsert as upsertLikedSongs,
} from "@/lib/domains/library/liked-songs/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import { getByIds, upsertCatalog } from "@/lib/domains/library/songs/queries";
import {
	completeJob,
	settleClaimedJob,
	startJob,
	takeOverJob,
} from "@/lib/platform/jobs/lifecycle";
import { getJobById, type Job } from "@/lib/platform/jobs/repository";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import type { SyncFailedError } from "@/lib/shared/errors/domain/sync";
import type { LikedSongsSyncResult, SpotifyTrackDTO } from "./types";

type SyncOperationError = DbError | SyncFailedError;

/**
 * Transforms a SpotifyTrackDTO to catalog metadata for song upsert.
 * Does not include enrichment-owned fields (genres).
 */
function mapSpotifyTrackToSongData(
	st: SpotifyTrackDTO,
	options: { honorReleaseYearChecked: boolean },
) {
	return {
		spotify_id: st.track.id,
		name: st.track.name,
		album_id: st.track.album.id,
		album_name: st.track.album.name,
		image_url: st.track.album.images[0]?.url ?? null,
		artists: st.track.artists.map((a) => a.name),
		artist_ids: st.track.artists.map((a) => a.id),
		duration_ms: st.track.duration_ms,
		release_year: st.track.release_year ?? null,
		...(options.honorReleaseYearChecked && st.track.release_year_checked
			? { release_year_checked_at: new Date().toISOString() }
			: {}),
	};
}

/**
 * Shared import path for Spotify tracks used by both liked-song and playlist-track sync.
 * Maps tracks → catalog upsert (no genre overwrite) → persist artist metadata → return spotify_id→Song map.
 * The liked-song-only release_year_checked signal is ignored unless callers opt
 * in, so playlist imports can never stamp release_year_checked_at.
 */
export async function importSpotifyTracks(
	tracks: SpotifyTrackDTO[],
	options: { honorReleaseYearChecked?: boolean } = {},
): Promise<Result<Map<string, Song>, SyncOperationError>> {
	const songData = tracks.map((track) =>
		mapSpotifyTrackToSongData(track, {
			honorReleaseYearChecked: options.honorReleaseYearChecked ?? false,
		}),
	);

	const upsertedResult = await upsertCatalog(songData);
	if (Result.isError(upsertedResult)) {
		return Result.err(upsertedResult.error);
	}

	const artistData = collectArtistUpsertData(tracks);
	if (artistData.length > 0) {
		const artistResult = await upsertArtists(artistData);
		if (Result.isError(artistResult)) {
			console.warn("Artist upsert failed:", artistResult.error.message);
		}
	}

	const songMap = new Map(upsertedResult.value.map((s) => [s.spotify_id, s]));
	return Result.ok(songMap);
}

/**
 * Extracts unique artist metadata from extension-provided track payloads.
 * Prefers the first non-null image URL/bio when the same artist appears multiple times.
 * Omits null metadata so syncs without hydration never erase stored artist data.
 */
function collectArtistUpsertData(
	tracks: SpotifyTrackDTO[],
): ArtistUpsertData[] {
	const uniqueArtists = new Map<string, ArtistUpsertData>();

	for (const st of tracks) {
		for (const a of st.track.artists) {
			const existing = uniqueArtists.get(a.id);
			if (!existing) {
				uniqueArtists.set(a.id, {
					spotify_id: a.id,
					name: a.name,
					...(a.imageUrl != null ? { image_url: a.imageUrl } : {}),
					...(a.bio != null ? { bio: a.bio } : {}),
				});
				continue;
			}

			if (existing.image_url == null && a.imageUrl != null) {
				existing.image_url = a.imageUrl;
			}
			if (existing.bio == null && a.bio != null) {
				existing.bio = a.bio;
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
async function importLikedTracks(
	accountId: string,
	tracks: SpotifyTrackDTO[],
): Promise<Result<Song[], SyncOperationError>> {
	const songMapResult = await importSpotifyTracks(tracks, {
		honorReleaseYearChecked: true,
	});
	if (Result.isError(songMapResult)) {
		return Result.err(songMapResult.error);
	}
	const songMap = songMapResult.value;

	const likedSongData = tracks.flatMap((st: SpotifyTrackDTO) => {
		const song = songMap.get(st.track.id);
		return song ? [{ song_id: song.id, liked_at: st.added_at }] : [];
	});

	const likedResult = await upsertLikedSongs(accountId, likedSongData);
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
		existingLikedSongs: LikedSongRef[];
		likedSongsIds: Set<string>;
	},
): Promise<Result<LikedSongsSyncResult, SyncOperationError>> {
	const { likedSongs, existingLikedSongs, likedSongsIds } = data;
	const existingSongIds = existingLikedSongs.map(
		(ls: LikedSongRef) => ls.song_id,
	);
	const songsResult = await getByIds(
		existingSongIds.filter((id: string) => id.length > 0),
	);
	if (Result.isError(songsResult)) {
		return Result.err(songsResult.error);
	}
	const existingSongs = songsResult.value;

	// Diff against songs the account *currently* likes — a row with unliked_at set
	// does not count as present. This is what lets a re-like resurface: its row
	// exists (so it isn't "new") but is soft-deleted (so it isn't "active"),
	// landing it in toAdd where the self-healing upsert clears unliked_at. Diffing
	// against every row, soft-deleted or not, would drop a re-like into neither
	// bucket and lose the song from the library permanently.
	const songIdToSpotifyId = new Map(
		existingSongs.map((s: Song) => [s.id, s.spotify_id]),
	);
	const activeSpotifyIds = new Set(
		existingLikedSongs
			.filter((ls: LikedSongRef) => ls.unliked_at === null)
			.map((ls: LikedSongRef) => songIdToSpotifyId.get(ls.song_id))
			.filter((id): id is string => id !== undefined),
	);

	const toAdd = likedSongs.filter(
		(st: SpotifyTrackDTO) => !activeSpotifyIds.has(st.track.id),
	);
	// Only soft-delete songs the account still actively likes; re-stamping an
	// already-unliked row would inflate `removed` and re-fire downstream
	// library-processing on every sync.
	const toRemove = existingSongs.filter(
		(s: Song) =>
			activeSpotifyIds.has(s.spotify_id) && !likedSongsIds.has(s.spotify_id),
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
		const deleteResult = await softDeleteLikedSongs(
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

// "superseded": a parent attempt at least as new as this run's holds the
// phase, or moved it to terminal under this run; either way this run does not
// own it.
export type PhaseOutcome<T> =
	| { status: "completed"; value: T }
	| { status: "superseded" };

/**
 * Runs one sync phase on its phase job, leased under the parent's claim
 * attempt (`phase.attempts`, see markJobRunning). The phase's result is
 * persisted on the job as it completes, so a retry of the same sync (after a
 * crash further down the parent run) reuses it instead of re-diffing an
 * already-applied library to zero changes. `resultSchema` parses that
 * persisted result back.
 */
export async function runPhase<T extends Json>(
	phase: Pick<Job, "id" | "attempts">,
	resultSchema: z.ZodType<T>,
	syncFn: () => Promise<Result<T, SyncOperationError>>,
): Promise<Result<PhaseOutcome<T>, SyncOperationError>> {
	const startResult = await startJob(phase);
	if (Result.isError(startResult)) {
		return Result.err(startResult.error);
	}
	if (startResult.value === "superseded") {
		return resumePhase(phase, resultSchema, syncFn);
	}
	return runHeldPhase(phase, syncFn);
}

async function runHeldPhase<T extends Json>(
	phase: Pick<Job, "id" | "attempts">,
	syncFn: () => Promise<Result<T, SyncOperationError>>,
): Promise<Result<PhaseOutcome<T>, SyncOperationError>> {
	const result = await syncFn();

	if (Result.isError(result)) {
		const failResult = await settleClaimedJob(
			phase,
			"failed",
			result.error.message,
		);
		if (Result.isError(failResult)) {
			return Result.err(failResult.error);
		}
		if (failResult.value === "superseded") {
			return Result.ok({ status: "superseded" });
		}
		return result;
	}

	const completeResult = await completeJob(phase, { result: result.value });
	if (Result.isError(completeResult)) {
		return Result.err(completeResult.error);
	}
	if (completeResult.value === "superseded") {
		return Result.ok({ status: "superseded" });
	}

	return Result.ok({ status: "completed", value: result.value });
}

async function resumePhase<T extends Json>(
	phase: Pick<Job, "id" | "attempts">,
	resultSchema: z.ZodType<T>,
	syncFn: () => Promise<Result<T, SyncOperationError>>,
): Promise<Result<PhaseOutcome<T>, SyncOperationError>> {
	const jobId = phase.id;
	const jobResult = await getJobById(jobId);
	if (Result.isError(jobResult)) {
		return Result.err(jobResult.error);
	}
	const job = jobResult.value;
	if (!job) {
		return Result.err(
			new DatabaseError({
				code: "phase_job_missing",
				message: `Phase job ${jobId} not found`,
			}),
		);
	}

	switch (job.status) {
		case "pending":
			return Result.ok({ status: "superseded" });
		case "running": {
			// Only one worker holds the parent lease, so a phase left running by
			// an older parent attempt belongs to a run that crashed or lost its
			// lease: without taking it over, every retry would stop here until
			// the parent is dead-lettered. The takeover fences that run's late
			// settle out.
			if (job.attempts >= phase.attempts) {
				return Result.ok({ status: "superseded" });
			}
			const takeover = await takeOverJob(phase);
			if (Result.isError(takeover)) {
				return Result.err(takeover.error);
			}
			if (takeover.value === "superseded") {
				// The older run settled it, or a newer attempt took it, in between.
				return resumePhase(phase, resultSchema, syncFn);
			}
			return runHeldPhase(phase, syncFn);
		}
		case "failed":
			// A terminal failure cannot be re-run; the sync it belongs to cannot
			// finish, so surface the phase's own error.
			return Result.err(
				new DatabaseError({
					code: "phase_job_failed",
					message: job.error ?? `Phase job ${jobId} failed`,
				}),
			);
		case "completed": {
			const progress =
				typeof job.progress === "object" &&
				job.progress !== null &&
				!Array.isArray(job.progress)
					? job.progress
					: {};
			const parsed = resultSchema.safeParse(progress.result);
			if (!parsed.success) {
				return Result.err(
					new DatabaseError({
						code: "phase_result_bad_shape",
						message: `Phase job ${jobId} completed without a readable result: ${parsed.error.message}`,
					}),
				);
			}
			return Result.ok({ status: "completed", value: parsed.data });
		}
	}
}

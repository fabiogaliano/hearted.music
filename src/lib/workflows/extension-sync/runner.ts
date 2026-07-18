/**
 * Bun worker handler for the extension_sync parent job.
 *
 * This is the orchestration that used to run inline in POST /api/extension/sync,
 * relocated to the worker where there is no Cloudflare subrequest cap or 10 ms
 * CPU budget. It downloads the staged payload from Storage, validates it once
 * against SyncPayloadSchema, runs the three sync phases against the existing
 * phase jobs, applies the post-sync library-processing + billing tail, then
 * settles the parent job and deletes the Storage object.
 *
 * Mirrors src/lib/workflows/library-processing/runner.ts in shape.
 */

import { captureException } from "@sentry/bun";
import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { TablesUpdate } from "@/lib/data/database.types";
import { maybeGrantLikedSongAccessAfterSync } from "@/lib/domains/billing/liked-song-access-grant";
import { getAll } from "@/lib/domains/library/liked-songs/queries";
import {
	getPlaylists,
	getTargetPlaylists,
	type Playlist,
} from "@/lib/domains/library/playlists/queries";
import { log } from "@/lib/observability/logger";
import { parseExtensionSyncJobProgress } from "@/lib/platform/jobs/extension-sync-jobs";
import { completeJob, failJob, startJob } from "@/lib/platform/jobs/lifecycle";
import type { Job } from "@/lib/platform/jobs/repository";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { mapWithConcurrency } from "@/lib/shared/utils/concurrency";
import {
	deleteSyncPayload,
	downloadSyncPayload,
} from "@/lib/workflows/extension-sync/payload-storage";
import { SyncChanges } from "@/lib/workflows/library-processing/changes";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";
import {
	syncPlaylists,
	syncPlaylistTracksFromData,
} from "@/lib/workflows/spotify-sync/playlist-sync";
import {
	incrementalSync,
	initialSync,
	runPhase,
} from "@/lib/workflows/spotify-sync/sync-helpers";
import {
	type SyncPayload,
	SyncPayloadSchema,
} from "../../../../shared/spotify-sync-payload-schema";

export type ExtensionSyncRunOutcome =
	| { status: "completed" }
	| { status: "failed"; error: string };

interface PhaseResults {
	likedSongs?: { total: number; added: number; removed: number };
	playlists?: {
		removedTargetPlaylistIds: string[];
		updatedTargetProfileTextPlaylistIds: string[];
	};
	playlistTracks?: { playlistsChanged: number };
}

/**
 * Surfaces an operational extension-sync failure to Sentry before the job is
 * marked failed. Without this, a failed sync only leaves a `failed` job row +
 * `log.*` line (the worker runs with `enableLogs:false`), so incidents require
 * DB/log spelunking. Uses `@sentry/bun` because this runs in the worker, not on
 * Cloudflare. `level` lets a likely-client bad payload land as a warning instead
 * of an error.
 */
function captureExtensionSyncFailure(
	error: unknown,
	context: {
		phase: string;
		jobId: string;
		accountId: string;
		level?: "warning" | "error";
	},
): void {
	captureException(error, {
		level: context.level ?? "error",
		tags: { workflow: "extension_sync", phase: context.phase },
		extra: { jobId: context.jobId, accountId: context.accountId },
	});
}

/**
 * Runs a claimed extension_sync parent job to terminal state. Always returns an
 * outcome (never throws); the caller logs + heartbeats. The Storage object is
 * deleted on both success and failure — the payload is reproducible by
 * re-syncing, so keeping failed payloads would only erode the 1 GB quota.
 */
export async function runExtensionSyncJob(
	job: Job,
	actor: string,
): Promise<ExtensionSyncRunOutcome> {
	const accountId = job.account_id;
	const supabase = createAdminSupabaseClient();

	const progressResult = parseExtensionSyncJobProgress(job.progress);
	if (Result.isError(progressResult)) {
		// No payload pointer means nothing the worker can do; fail the parent.
		// Phase ids are unknown here, so there is nothing else to settle.
		const message = `Invalid extension_sync job progress: ${progressResult.error.message}`;
		await failJob(job.id, message);
		return { status: "failed", error: message };
	}

	const { payload_path: payloadPath, phase_job_ids: phaseJobIds } =
		progressResult.value;

	// A phase job is "settled" only after a confirmed terminal transition. On any
	// failure path, failUnsettled fails whatever has not reached terminal so no
	// sync_* row is left pending/running to lock the account out via the gate.
	const settledJobIds = new Set<string>();
	const failUnsettledPhaseJobs = async (reason: string): Promise<void> => {
		const unsettled = [
			phaseJobIds.liked_songs,
			phaseJobIds.playlists,
			phaseJobIds.playlist_tracks,
		].filter((id) => !settledJobIds.has(id));
		await Promise.all(unsettled.map((id) => failJob(id, reason)));
	};

	const fail = async (reason: string): Promise<ExtensionSyncRunOutcome> => {
		await failUnsettledPhaseJobs(reason);
		await failJob(job.id, reason);
		await deletePayloadBestEffort(supabase, payloadPath, job.id, actor);
		return { status: "failed", error: reason };
	};

	// Download + validate the payload. Validation now lives here (the ingress
	// streamed the raw bytes straight to Storage), so a bad payload fails the
	// job with the Zod message instead of a 400 the extension can't see.
	const downloadResult = await downloadSyncPayload(supabase, payloadPath);
	if (Result.isError(downloadResult)) {
		captureExtensionSyncFailure(downloadResult.error, {
			phase: "download_payload",
			jobId: job.id,
			accountId,
		});
		return fail(
			`Failed to download sync payload: ${downloadResult.error.message}`,
		);
	}

	let payload: SyncPayload;
	try {
		payload = SyncPayloadSchema.parse(JSON.parse(downloadResult.value));
	} catch (error) {
		// A malformed payload is most likely a bad client upload, so report it as a
		// warning rather than an error to keep the issue feed honest.
		captureExtensionSyncFailure(error, {
			phase: "parse_payload",
			jobId: job.id,
			accountId,
			level: "warning",
		});
		return fail(`Invalid sync payload: ${errorMessage(error)}`);
	}

	try {
		const profileResult = await applyUserProfile(supabase, accountId, payload);
		if (Result.isError(profileResult)) {
			return fail(profileResult.error);
		}

		const results: PhaseResults = {};
		const changedPlaylistIds: string[] = [];

		// Phase 1: liked songs
		const likedSongs = payload.likedSongs;
		if (likedSongs.length > 0) {
			const songsResult = await runPhase(phaseJobIds.liked_songs, async () => {
				const existingResult = await getAll(accountId);
				if (Result.isError(existingResult)) return existingResult;

				const isInitial = existingResult.value.length === 0;
				return isInitial
					? initialSync(accountId, likedSongs)
					: incrementalSync(accountId, {
							likedSongs,
							existingLikedSongs: existingResult.value,
							likedSongsIds: new Set(likedSongs.map((t) => t.track.id)),
						});
			});

			if (Result.isError(songsResult)) {
				captureExtensionSyncFailure(songsResult.error, {
					phase: "liked_songs_sync",
					jobId: job.id,
					accountId,
				});
				return fail(`Liked songs sync failed: ${songsResult.error.message}`);
			}
			settledJobIds.add(phaseJobIds.liked_songs);
			results.likedSongs = {
				total: songsResult.value.total,
				added: songsResult.value.added,
				removed: songsResult.value.removed,
			};
		} else {
			const completeResult = await completeJob(phaseJobIds.liked_songs);
			if (Result.isError(completeResult)) {
				captureExtensionSyncFailure(completeResult.error, {
					phase: "finalize_liked_songs",
					jobId: job.id,
					accountId,
				});
				return fail("Failed to finalize liked songs job");
			}
			settledJobIds.add(phaseJobIds.liked_songs);
		}

		// Phase 2: playlists
		const extensionPlaylists = payload.playlists;
		if (extensionPlaylists.length > 0) {
			const playlistResult = await runPhase(phaseJobIds.playlists, () =>
				syncPlaylists(accountId, extensionPlaylists),
			);
			if (Result.isError(playlistResult)) {
				captureExtensionSyncFailure(playlistResult.error, {
					phase: "playlist_sync",
					jobId: job.id,
					accountId,
				});
				return fail(`Playlist sync failed: ${playlistResult.error.message}`);
			}
			settledJobIds.add(phaseJobIds.playlists);
			results.playlists = {
				removedTargetPlaylistIds: playlistResult.value.removedTargetPlaylistIds,
				updatedTargetProfileTextPlaylistIds:
					playlistResult.value.updatedTargetProfileTextPlaylistIds,
			};
		} else {
			const completeResult = await completeJob(phaseJobIds.playlists);
			if (Result.isError(completeResult)) {
				captureExtensionSyncFailure(completeResult.error, {
					phase: "finalize_playlists",
					jobId: job.id,
					accountId,
				});
				return fail("Failed to finalize playlists job");
			}
			settledJobIds.add(phaseJobIds.playlists);
		}

		// Phase 3: playlist tracks
		const incomingPlaylistTracks = payload.playlistTracks ?? [];
		if (incomingPlaylistTracks.length > 0) {
			const startResult = await startJob(phaseJobIds.playlist_tracks);
			if (Result.isError(startResult)) {
				captureExtensionSyncFailure(startResult.error, {
					phase: "start_playlist_tracks",
					jobId: job.id,
					accountId,
				});
				return fail("Failed to start playlist tracks job");
			}

			const dbPlaylistsResult = await getPlaylists(accountId);
			const dbPlaylistMap = Result.isOk(dbPlaylistsResult)
				? new Map(dbPlaylistsResult.value.map((p) => [p.spotify_id, p]))
				: new Map<string, Playlist>();

			const trackSyncResults = await mapWithConcurrency(
				incomingPlaylistTracks,
				4,
				async (entry) => {
					const dbPlaylist = dbPlaylistMap.get(entry.playlistSpotifyId);
					if (!dbPlaylist) return { changedPlaylistId: null };

					const trackResult = await syncPlaylistTracksFromData(
						dbPlaylist,
						entry.tracks,
					);
					if (Result.isError(trackResult)) return { changedPlaylistId: null };

					const changed =
						trackResult.value.added > 0 || trackResult.value.removed > 0;
					return { changedPlaylistId: changed ? dbPlaylist.id : null };
				},
			);

			changedPlaylistIds.push(
				...trackSyncResults.flatMap((r) =>
					r.changedPlaylistId ? [r.changedPlaylistId] : [],
				),
			);

			const completeResult = await completeJob(phaseJobIds.playlist_tracks);
			if (Result.isError(completeResult)) {
				captureExtensionSyncFailure(completeResult.error, {
					phase: "finalize_playlist_tracks",
					jobId: job.id,
					accountId,
				});
				return fail("Failed to finalize playlist tracks job");
			}
			settledJobIds.add(phaseJobIds.playlist_tracks);
			results.playlistTracks = { playlistsChanged: changedPlaylistIds.length };
		} else {
			const completeResult = await completeJob(phaseJobIds.playlist_tracks);
			if (Result.isError(completeResult)) {
				captureExtensionSyncFailure(completeResult.error, {
					phase: "finalize_playlist_tracks",
					jobId: job.id,
					accountId,
				});
				return fail("Failed to finalize playlist tracks job");
			}
			settledJobIds.add(phaseJobIds.playlist_tracks);
		}

		// Classify and emit one aggregated library-processing change.
		const applyResult = await applyLibraryProcessingChange(
			SyncChanges.librarySynced(
				accountId,
				classifyChange(
					results,
					changedPlaylistIds,
					await getTargetIds(accountId),
				),
			),
		);
		if (Result.isError(applyResult)) {
			captureExtensionSyncFailure(applyResult.error, {
				phase: "library_processing_apply",
				jobId: job.id,
				accountId,
			});
			return fail("library_processing_apply_failed");
		}

		// Automatic waitlist path. Best-effort — never fails the sync. The reporter
		// routes the grant's swallowed DB errors to the worker's @sentry/bun runtime
		// (the domain module is SDK-agnostic so it can run here, not just on CF).
		try {
			await maybeGrantLikedSongAccessAfterSync(supabase, accountId, {
				onOperationalError: (error, context) => {
					captureException(error, {
						tags: {
							area: "billing",
							operation: "maybe_grant_liked_song_access_after_sync",
							runtime: "worker",
						},
						extra: {
							accountId,
							jobId: job.id,
							stage: context.stage,
							...(context.origin ? { origin: context.origin } : {}),
						},
					});
				},
			});
		} catch (grantError) {
			// The reporter above only sees the grant's *handled* swallows; an
			// unexpected throw from maybeGrantLikedSongAccessAfterSync itself lands
			// here. The worker runs with enableLogs:false, so log.error never reaches
			// Sentry — capture explicitly while still swallowing so the job stays
			// best-effort.
			log.error("extension-sync-grant-threw", {
				actor,
				jobId: job.id,
				accountId,
				error: errorMessage(grantError),
			});
			captureException(grantError, {
				tags: {
					area: "billing",
					operation: "maybe_grant_liked_song_access_after_sync",
					runtime: "worker",
				},
				extra: { accountId, jobId: job.id, stage: "grant_threw" },
			});
		}

		const completeParent = await completeJob(job.id);
		if (Result.isError(completeParent)) {
			captureExtensionSyncFailure(completeParent.error, {
				phase: "complete_parent_job",
				jobId: job.id,
				accountId,
			});
			return { status: "failed", error: completeParent.error.message };
		}

		await deletePayloadBestEffort(supabase, payloadPath, job.id, actor);
		return { status: "completed" };
	} catch (error) {
		// Catch-all for an unexpected throw in any phase above (the phase guards
		// return early, so this only fires on a genuinely unhandled error).
		captureExtensionSyncFailure(error, {
			phase: "unexpected",
			jobId: job.id,
			accountId,
		});
		return fail(errorMessage(error));
	}
}

async function getTargetIds(accountId: string): Promise<Set<string>> {
	const targetResult = await getTargetPlaylists(accountId);
	return Result.isOk(targetResult)
		? new Set(targetResult.value.map((p) => p.id))
		: new Set<string>();
}

function classifyChange(
	results: PhaseResults,
	changedPlaylistIds: string[],
	currentTargetIds: Set<string>,
): {
	likedSongs: { added: boolean; removed: boolean };
	targetPlaylists: {
		trackMembershipChanged: boolean;
		profileTextChanged: boolean;
		removed: boolean;
	};
} {
	const removedTargets = results.playlists?.removedTargetPlaylistIds ?? [];
	const updatedProfileTextTargets =
		results.playlists?.updatedTargetProfileTextPlaylistIds ?? [];

	const trackMembershipChanged =
		(results.playlistTracks?.playlistsChanged ?? 0) > 0 &&
		changedPlaylistIds.some((id) => currentTargetIds.has(id));

	const profileTextChanged =
		updatedProfileTextTargets.length > 0 &&
		updatedProfileTextTargets.some((id) => currentTargetIds.has(id));

	return {
		likedSongs: {
			added: (results.likedSongs?.added ?? 0) > 0,
			removed: (results.likedSongs?.removed ?? 0) > 0,
		},
		targetPlaylists: {
			trackMembershipChanged,
			profileTextChanged,
			removed: removedTargets.length > 0,
		},
	};
}

/**
 * Ports the route's account-linking guards. A spotify_id already linked to a
 * different account, or a mismatch against this account's existing link, fails
 * the sync (these were 409s inline). Otherwise backfills spotify_id / display
 * name / image from the payload's userProfile.
 */
async function applyUserProfile(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string,
	payload: SyncPayload,
): Promise<Result<void, string>> {
	if (!payload.userProfile) return Result.ok(undefined);

	const [{ data: conflictAccount }, { data: currentAccount }] =
		await Promise.all([
			supabase
				.from("account")
				.select("id")
				.eq("spotify_id", payload.userProfile.spotifyId)
				.neq("id", accountId)
				.maybeSingle(),
			supabase
				.from("account")
				.select("spotify_id, better_auth_user_id")
				.eq("id", accountId)
				.single(),
		]);

	if (conflictAccount) {
		return Result.err(
			"This Spotify account is already linked to a different user",
		);
	}

	if (currentAccount) {
		if (
			currentAccount.spotify_id &&
			currentAccount.spotify_id !== payload.userProfile.spotifyId
		) {
			return Result.err(
				"Sync payload spotify_id does not match linked account",
			);
		}

		const accountUpdate: Pick<
			TablesUpdate<"account">,
			"spotify_id" | "display_name" | "image_url"
		> = {};
		if (!currentAccount.spotify_id) {
			accountUpdate.spotify_id = payload.userProfile.spotifyId;
		}
		if (payload.userProfile.displayName) {
			accountUpdate.display_name = payload.userProfile.displayName;
		}
		if (payload.userProfile.avatarUrl) {
			accountUpdate.image_url = payload.userProfile.avatarUrl;
		}

		if (Object.keys(accountUpdate).length > 0) {
			const { error: updateError } = await supabase
				.from("account")
				.update(accountUpdate)
				.eq("id", accountId);
			if (updateError) {
				return Result.err(
					`Failed to update account profile: ${updateError.message}`,
				);
			}
		}
	}

	return Result.ok(undefined);
}

async function deletePayloadBestEffort(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	payloadPath: string,
	jobId: string,
	actor: string,
): Promise<void> {
	const deleteResult = await deleteSyncPayload(supabase, payloadPath);
	if (Result.isError(deleteResult)) {
		log.warn("extension-sync-payload-delete-failed", {
			actor,
			jobId,
			payloadPath,
			error: deleteResult.error.message,
		});
	}
}

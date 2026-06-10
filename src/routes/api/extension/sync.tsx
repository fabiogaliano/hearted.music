/**
 * Extension Sync API Route
 *
 * POST /api/extension/sync
 *
 * Accepts pre-fetched Spotify data from the Chrome extension and syncs it
 * to the database. The extension uses Spotify's internal Pathfinder API
 * (via intercepted session tokens) to fetch data without OAuth, then
 * pushes it here for persistence.
 *
 * Creates job records for each sync phase so the web app can poll progress.
 *
 * Auth: Better Auth session cookie OR Bearer token (extension API token)
 */

import { createFileRoute } from "@tanstack/react-router";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { TablesUpdate } from "@/lib/data/database.types";
import { maybeGrantLikedSongAccessAfterSync } from "@/lib/domains/billing/liked-song-access-grant";
import { updatePhaseJobIds } from "@/lib/domains/library/accounts/preferences-queries";
import { getAll } from "@/lib/domains/library/liked-songs/queries";
import {
	getPlaylists,
	getTargetPlaylists,
	type Playlist,
} from "@/lib/domains/library/playlists/queries";
import { getAuthSession } from "@/lib/platform/auth/auth.server";
import { validateExtensionApiToken } from "@/lib/platform/auth/extension-api-tokens";
import { completeJob, failJob, startJob } from "@/lib/platform/jobs/lifecycle";
import type { PhaseJobIds } from "@/lib/platform/jobs/progress/types";
import { createJob } from "@/lib/platform/jobs/repository";
import {
	getActiveSync,
	getLastCompletedSync,
	markStaleSyncJobs,
} from "@/lib/platform/jobs/sync-phase-jobs";
import {
	extensionCorsPreflightResponse,
	getExtensionCorsHeaders,
} from "@/lib/server/extension-cors";
import { mapWithConcurrency } from "@/lib/shared/utils/concurrency";
import { SyncChanges } from "@/lib/workflows/library-processing/changes/sync";
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
import type {
	SpotifyPlaylistDTO,
	SpotifyTrackDTO,
} from "@/lib/workflows/spotify-sync/types";
import { captureWithWaitUntil } from "@/utils/posthog-server";
import {
	EXTENSION_SYNC_ALREADY_RUNNING,
	EXTENSION_SYNC_COOLDOWN,
} from "../../../../shared/extension-sync-contract";

// Per-phase sync outcomes. Typed so the downstream classification step reads
// each phase's fields directly instead of re-casting an untyped accumulator.
interface PhaseResults {
	likedSongs?: {
		total: number;
		added: number;
		removed: number;
	};
	playlists?: {
		total: number;
		created: number;
		updated: number;
		removed: number;
		removedTargetPlaylistIds: string[];
		updatedTargetMetadataPlaylistIds: string[];
		updatedTargetProfileTextPlaylistIds: string[];
	};
	playlistTracks?: {
		total: number;
		playlistsSynced: number;
		playlistsChanged: number;
	};
}

const SpotifyTrackDTOSchema = z.object({
	added_at: z.string(),
	track: z.object({
		id: z.string(),
		name: z.string(),
		artists: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				imageUrl: z.string().nullable().optional(),
				bio: z.string().nullable().optional(),
			}),
		),
		album: z.object({
			id: z.string(),
			name: z.string(),
			images: z.array(
				z.object({
					url: z.string(),
					width: z.number().optional(),
					height: z.number().optional(),
				}),
			),
		}),
		duration_ms: z.number(),
		uri: z.string(),
	}),
});

const SpotifyPlaylistDTOSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	owner: z.object({
		id: z.string(),
		name: z.string().optional(),
		image_url: z.string().nullable().optional(),
	}),
	track_count: z.number().nullable(),
	image_url: z.string().nullable(),
});

// Spotify-aligned ceilings: above any real library, below "this is an attack".
// Caps bound post-validation work (DB writes + per-row job enqueues); the
// MAX_SYNC_BODY_BYTES guard below bounds pre-validation memory since
// request.json() buffers the whole body before Zod runs.
const MAX_LIKED_SONGS = 50_000;
const MAX_PLAYLISTS = 11_000;
const MAX_TRACKS_PER_PLAYLIST = 10_000;
const MAX_SYNC_BODY_BYTES = 20 * 1024 * 1024;
const SYNC_COOLDOWN_MS = 60_000;

// Sync jobs are inline request work with no worker sweep. If a request dies
// after creating phase jobs, the rows stay active and lock getActiveSync's
// gate. A request that legitimately takes this long is already lost, so any
// sync_* job older than this is safe to fail before a fresh attempt. Comfortably
// above any real sync duration.
const SYNC_STALE_THRESHOLD = "10 minutes";

const PlaylistTrackEntrySchema = z.object({
	playlistSpotifyId: z.string(),
	tracks: z.array(SpotifyTrackDTOSchema).max(MAX_TRACKS_PER_PLAYLIST),
});

const SyncPayloadSchema = z.object({
	likedSongs: z.array(SpotifyTrackDTOSchema).max(MAX_LIKED_SONGS),
	playlists: z.array(SpotifyPlaylistDTOSchema).max(MAX_PLAYLISTS),
	playlistTracks: z
		.array(PlaylistTrackEntrySchema)
		.max(MAX_PLAYLISTS)
		.optional(),
	userProfile: z
		.object({
			spotifyId: z.string(),
			displayName: z.string().optional(),
			username: z.string().optional(),
			avatarUrl: z.string().nullable().optional(),
			email: z.string().optional(),
		})
		.optional(),
});

function getRetryAfterSeconds(remainingMs: number): number {
	return Math.max(1, Math.ceil(remainingMs / 1000));
}

export const Route = createFileRoute("/api/extension/sync")({
	server: {
		handlers: {
			OPTIONS: async ({ request }) => extensionCorsPreflightResponse(request),
			POST: async ({ request }) => {
				const corsHeaders = getExtensionCorsHeaders(request);
				let accountId: string | null = null;

				const authContext = await getAuthSession();
				if (authContext) {
					accountId = authContext.session.accountId;
				} else {
					const authHeader = request.headers.get("Authorization");
					if (authHeader?.startsWith("Bearer ")) {
						const token = authHeader.slice(7);
						const tokenResult = await validateExtensionApiToken(token);
						if (Result.isOk(tokenResult) && tokenResult.value) {
							accountId = tokenResult.value;
						}
					}
				}

				if (!accountId) {
					return Response.json(
						{ error: "Not authenticated" },
						{ status: 401, headers: corsHeaders },
					);
				}

				// Self-heal before the active gate: fail any sync_* jobs orphaned by a
				// prior request that died mid-flight, so getActiveSync reflects reality
				// instead of locking the account into a permanent 429. Best-effort —
				// a cleanup failure shouldn't block a legitimate sync.
				const staleCleanupResult = await markStaleSyncJobs(
					accountId,
					SYNC_STALE_THRESHOLD,
				);
				if (Result.isError(staleCleanupResult)) {
					console.warn(
						"Failed to clean up stale sync jobs:",
						staleCleanupResult.error,
					);
				}

				const [activeSyncResult, lastCompletedSyncResult] = await Promise.all([
					getActiveSync(accountId),
					getLastCompletedSync(accountId),
				]);

				if (
					Result.isError(activeSyncResult) ||
					Result.isError(lastCompletedSyncResult)
				) {
					return Response.json(
						{ error: "Failed to inspect recent sync activity" },
						{ status: 500, headers: corsHeaders },
					);
				}

				if (activeSyncResult.value) {
					return Response.json(
						{
							code: EXTENSION_SYNC_ALREADY_RUNNING,
							error:
								"A library sync is already running for this account. Wait for it to finish before trying again.",
						},
						{ status: 429, headers: corsHeaders },
					);
				}

				const lastCompletedSync = lastCompletedSyncResult.value;
				const lastCompletedAt = lastCompletedSync?.completed_at;
				if (typeof lastCompletedAt === "string") {
					const elapsedMs = Date.now() - new Date(lastCompletedAt).getTime();
					if (elapsedMs < SYNC_COOLDOWN_MS) {
						const retryAfterSeconds = getRetryAfterSeconds(
							SYNC_COOLDOWN_MS - elapsedMs,
						);
						return Response.json(
							{
								code: EXTENSION_SYNC_COOLDOWN,
								error:
									"Library sync was run too recently for this account. Wait before trying again.",
								retryAfterSeconds,
							},
							{
								status: 429,
								headers: {
									...corsHeaders,
									"Retry-After": String(retryAfterSeconds),
								},
							},
						);
					}
				}

				const declaredLength = Number(request.headers.get("content-length"));
				if (
					Number.isFinite(declaredLength) &&
					declaredLength > MAX_SYNC_BODY_BYTES
				) {
					return Response.json(
						{ error: "Payload too large" },
						{ status: 413, headers: corsHeaders },
					);
				}

				let payload: z.infer<typeof SyncPayloadSchema>;
				try {
					const body = await request.json();
					payload = SyncPayloadSchema.parse(body);
				} catch {
					return Response.json(
						{ error: "Invalid payload" },
						{ status: 400, headers: corsHeaders },
					);
				}

				if (payload.userProfile) {
					const supabase = createAdminSupabaseClient();

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
						return Response.json(
							{
								error:
									"This Spotify account is already linked to a different user",
							},
							{ status: 409, headers: corsHeaders },
						);
					}

					if (currentAccount) {
						if (
							currentAccount.spotify_id &&
							currentAccount.spotify_id !== payload.userProfile.spotifyId
						) {
							return Response.json(
								{
									error:
										"Sync payload spotify_id does not match linked account",
								},
								{ status: 409, headers: corsHeaders },
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
							await supabase
								.from("account")
								.update(accountUpdate)
								.eq("id", accountId);
						}
					}
				}

				const likedSongs: SpotifyTrackDTO[] = payload.likedSongs;
				const extensionPlaylists: SpotifyPlaylistDTO[] = payload.playlists;
				const incomingPlaylistTracks = payload.playlistTracks ?? [];

				// Acquire the per-account sync lock atomically. sync_liked_songs is the
				// lock sentinel, guarded by a partial unique index (one active
				// sync_liked_songs per account) — the DB is the single source of truth
				// here; the getActiveSync gate above is only a fast-path that spares us
				// parsing the body in the common case. Creating the sentinel first and
				// alone means a losing concurrent request creates no sibling rows to
				// orphan: the index rejects its insert as a unique ConstraintError,
				// which we map to the same "already running" 429 as the gate. Crucially
				// we do NOT fail this job on that path — the row belongs to the request
				// that won the race, and failing it would release its lock.
				const songsJobResult = await createJob(accountId, "sync_liked_songs");
				if (Result.isError(songsJobResult)) {
					if (songsJobResult.error._tag === "ConstraintError") {
						return Response.json(
							{
								code: EXTENSION_SYNC_ALREADY_RUNNING,
								error:
									"A library sync is already running for this account. Wait for it to finish before trying again.",
							},
							{ status: 429, headers: corsHeaders },
						);
					}
					return Response.json(
						{ error: "Failed to create sync jobs" },
						{ status: 500, headers: corsHeaders },
					);
				}

				// Lock held. Create the sibling phase jobs for progress tracking.
				const [playlistsJobResult, tracksJobResult] = await Promise.all([
					createJob(accountId, "sync_playlists"),
					createJob(accountId, "sync_playlist_tracks"),
				]);

				if (
					Result.isError(playlistsJobResult) ||
					Result.isError(tracksJobResult)
				) {
					// A partial batch leaves the created jobs (including the lock) pending;
					// fail them so they don't lock the next attempt out via the index and
					// the active-sync gate.
					const createdJobIds = [
						songsJobResult,
						playlistsJobResult,
						tracksJobResult,
					].flatMap((result) => (Result.isOk(result) ? [result.value.id] : []));
					await Promise.all(
						createdJobIds.map((id) =>
							failJob(id, "Sibling sync job creation failed"),
						),
					);
					return Response.json(
						{ error: "Failed to create sync jobs" },
						{ status: 500, headers: corsHeaders },
					);
				}

				const phaseJobIds: PhaseJobIds = {
					liked_songs: songsJobResult.value.id,
					playlists: playlistsJobResult.value.id,
					playlist_tracks: tracksJobResult.value.id,
				};

				// A phase job is "settled" only after a confirmed terminal transition.
				// On any early return or thrown path below, failUnsettled fails whatever
				// the route created but never drove to completion, so no sync_* row is
				// left pending/running to lock the account out.
				const settledJobIds = new Set<string>();
				const failUnsettledJobs = async (reason: string): Promise<void> => {
					const unsettled = [
						phaseJobIds.liked_songs,
						phaseJobIds.playlists,
						phaseJobIds.playlist_tracks,
					].filter((id) => !settledJobIds.has(id));
					await Promise.all(unsettled.map((id) => failJob(id, reason)));
				};

				try {
					// Persist to DB so the web app can discover them via preferences.
					// This stays inside the post-job-creation guard so a thrown write
					// still finalizes the fresh phase jobs in the catch below.
					const persistResult = await updatePhaseJobIds(accountId, phaseJobIds);
					if (Result.isError(persistResult)) {
						console.warn("Failed to persist phaseJobIds:", persistResult.error);
					}

					const results: PhaseResults = {};
					const changedPlaylistIds: string[] = [];

					// Phase 1: Sync liked songs
					if (likedSongs.length > 0) {
						const songsResult = await runPhase(
							phaseJobIds.liked_songs,
							async () => {
								const existingResult = await getAll(accountId);
								if (Result.isError(existingResult)) {
									return existingResult;
								}

								const isInitial = existingResult.value.length === 0;
								const syncResult = isInitial
									? await initialSync(accountId, likedSongs)
									: await incrementalSync(accountId, {
											likedSongs,
											existingLikedSongs: existingResult.value,
											likedSongsIds: new Set(likedSongs.map((t) => t.track.id)),
										});

								return syncResult;
							},
						);

						if (Result.isError(songsResult)) {
							await failUnsettledJobs(
								`Liked songs sync failed: ${songsResult.error.message}`,
							);
							return Response.json(
								{
									error: `Liked songs sync failed: ${songsResult.error.message}`,
									phaseJobIds,
								},
								{ status: 500, headers: corsHeaders },
							);
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
							await failUnsettledJobs("Failed to finalize liked songs job");
							return Response.json(
								{ error: "Failed to finalize sync jobs", phaseJobIds },
								{ status: 500, headers: corsHeaders },
							);
						}
						settledJobIds.add(phaseJobIds.liked_songs);
					}

					// Phase 2: Sync playlists
					if (extensionPlaylists.length > 0) {
						const playlistResult = await runPhase(
							phaseJobIds.playlists,
							async () => {
								const syncResult = await syncPlaylists(
									accountId,
									extensionPlaylists,
								);

								return syncResult;
							},
						);

						if (Result.isError(playlistResult)) {
							await failUnsettledJobs(
								`Playlist sync failed: ${playlistResult.error.message}`,
							);
							return Response.json(
								{
									error: `Playlist sync failed: ${playlistResult.error.message}`,
									phaseJobIds,
								},
								{ status: 500, headers: corsHeaders },
							);
						}

						settledJobIds.add(phaseJobIds.playlists);
						results.playlists = {
							total: playlistResult.value.total,
							created: playlistResult.value.created,
							updated: playlistResult.value.updated,
							removed: playlistResult.value.removed,
							removedTargetPlaylistIds:
								playlistResult.value.removedTargetPlaylistIds,
							updatedTargetMetadataPlaylistIds:
								playlistResult.value.updatedTargetMetadataPlaylistIds,
							updatedTargetProfileTextPlaylistIds:
								playlistResult.value.updatedTargetProfileTextPlaylistIds,
						};
					} else {
						const completeResult = await completeJob(phaseJobIds.playlists);
						if (Result.isError(completeResult)) {
							await failUnsettledJobs("Failed to finalize playlists job");
							return Response.json(
								{ error: "Failed to finalize sync jobs", phaseJobIds },
								{ status: 500, headers: corsHeaders },
							);
						}
						settledJobIds.add(phaseJobIds.playlists);
					}

					// Phase 3: Sync playlist tracks
					if (incomingPlaylistTracks.length > 0) {
						const startResult = await startJob(phaseJobIds.playlist_tracks);
						if (Result.isError(startResult)) {
							await failUnsettledJobs("Failed to start playlist tracks job");
							return Response.json(
								{ error: "Failed to start playlist tracks sync", phaseJobIds },
								{ status: 500, headers: corsHeaders },
							);
						}

						// Resolve DB playlists by spotify_id
						const dbPlaylistsResult = await getPlaylists(accountId);
						const dbPlaylistMap = Result.isOk(dbPlaylistsResult)
							? new Map(dbPlaylistsResult.value.map((p) => [p.spotify_id, p]))
							: new Map<string, Playlist>();

						const trackSyncResults = await mapWithConcurrency(
							incomingPlaylistTracks,
							4,
							async (entry) => {
								const dbPlaylist = dbPlaylistMap.get(entry.playlistSpotifyId);
								if (!dbPlaylist) {
									return { tracksProcessed: 0, changedPlaylistId: null };
								}

								const trackResult = await syncPlaylistTracksFromData(
									dbPlaylist,
									entry.tracks,
								);

								if (Result.isError(trackResult)) {
									return { tracksProcessed: 0, changedPlaylistId: null };
								}

								const changed =
									trackResult.value.added > 0 || trackResult.value.removed > 0;
								return {
									tracksProcessed: entry.tracks.length,
									changedPlaylistId: changed ? dbPlaylist.id : null,
								};
							},
						);

						const tracksProcessed = trackSyncResults.reduce(
							(total, result) => total + result.tracksProcessed,
							0,
						);
						changedPlaylistIds.push(
							...trackSyncResults.flatMap((result) =>
								result.changedPlaylistId ? [result.changedPlaylistId] : [],
							),
						);

						const completeResult = await completeJob(
							phaseJobIds.playlist_tracks,
						);
						if (Result.isError(completeResult)) {
							await failUnsettledJobs("Failed to finalize playlist tracks job");
							return Response.json(
								{ error: "Failed to finalize sync jobs", phaseJobIds },
								{ status: 500, headers: corsHeaders },
							);
						}
						settledJobIds.add(phaseJobIds.playlist_tracks);

						results.playlistTracks = {
							total: tracksProcessed,
							playlistsSynced: incomingPlaylistTracks.length,
							playlistsChanged: changedPlaylistIds.length,
						};
					} else {
						const completeResult = await completeJob(
							phaseJobIds.playlist_tracks,
						);
						if (Result.isError(completeResult)) {
							await failUnsettledJobs("Failed to finalize playlist tracks job");
							return Response.json(
								{ error: "Failed to finalize sync jobs", phaseJobIds },
								{ status: 500, headers: corsHeaders },
							);
						}
						settledJobIds.add(phaseJobIds.playlist_tracks);
					}

					// Classify sync results and emit one aggregated library-processing change
					const likedSongsResult = results.likedSongs;
					const playlistSyncResult = results.playlists;
					const playlistTracksResult = results.playlistTracks;

					// Compute target-side change facts before the data is stale
					const targetResult = await getTargetPlaylists(accountId);
					const currentTargetIds = Result.isOk(targetResult)
						? new Set(targetResult.value.map((p) => p.id))
						: new Set<string>();

					const removedTargets =
						playlistSyncResult?.removedTargetPlaylistIds ?? [];
					const updatedProfileTextTargets =
						playlistSyncResult?.updatedTargetProfileTextPlaylistIds ?? [];

					const trackMembershipChanged =
						(playlistTracksResult?.playlistsChanged ?? 0) > 0 &&
						changedPlaylistIds.some((id) => currentTargetIds.has(id));

					const profileTextChanged =
						updatedProfileTextTargets.length > 0 &&
						updatedProfileTextTargets.some((id) => currentTargetIds.has(id));

					const likedSongsAdded = (likedSongsResult?.added ?? 0) > 0;
					const likedSongsRemoved = (likedSongsResult?.removed ?? 0) > 0;
					const targetPlaylistsRemoved = removedTargets.length > 0;

					const applyResult = await applyLibraryProcessingChange(
						SyncChanges.librarySynced(accountId, {
							likedSongs: {
								added: likedSongsAdded,
								removed: likedSongsRemoved,
							},
							targetPlaylists: {
								trackMembershipChanged,
								profileTextChanged,
								removed: targetPlaylistsRemoved,
							},
						}),
					);

					if (Result.isError(applyResult)) {
						return Response.json(
							{
								ok: false,
								error: "library_processing_apply_failed",
								phaseJobIds,
							},
							{ status: 500, headers: corsHeaders },
						);
					}

					// Automatic waitlist path: apply any pending grant, else auto-grant
					// the liked-song access benefit to a newly-eligible waitlist account.
					// Best-effort — a failure here must never fail the sync response.
					try {
						await maybeGrantLikedSongAccessAfterSync(
							createAdminSupabaseClient(),
							accountId,
						);
					} catch (grantError) {
						console.error("[sync] liked-song access grant threw:", grantError);
					}

					const likedSongsSyncResult = results.likedSongs;
					await captureWithWaitUntil({
						distinctId: accountId,
						event: "library_synced",
						properties: {
							liked_songs_total: likedSongsSyncResult?.total,
							liked_songs_added: likedSongsSyncResult?.added ?? 0,
							liked_songs_removed: likedSongsSyncResult?.removed ?? 0,
							playlists_synced: extensionPlaylists.length,
							source: "extension",
						},
					});

					return Response.json(
						{
							ok: true,
							results,
							phaseJobIds,
						},
						{ headers: corsHeaders },
					);
				} catch (error) {
					// Any thrown path after job creation would otherwise leave phase
					// jobs pending/running and lock the account out; fail whatever
					// hasn't reached a terminal state before surfacing the failure.
					const message =
						error instanceof Error ? error.message : "Unexpected sync error";
					await failUnsettledJobs(message);
					return Response.json(
						{ ok: false, error: "sync_failed", phaseJobIds },
						{ status: 500, headers: corsHeaders },
					);
				}
			},
		},
	},
});

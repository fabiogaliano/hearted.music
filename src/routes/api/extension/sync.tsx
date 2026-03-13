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
 * Creates job records for each sync phase and emits SSE progress events
 * so the web app can subscribe via /api/jobs/$id/progress.
 *
 * Auth: Better Auth session cookie OR Bearer token (extension API token)
 */

import { createFileRoute } from "@tanstack/react-router";
import { Result } from "better-result";
import { z } from "zod";
import {
	extensionCorsPreflightResponse,
	getExtensionCorsHeaders,
} from "@/lib/server/extension-cors";
import * as likedSongData from "@/lib/domains/library/liked-songs/queries";
import { PlaylistSyncService } from "@/lib/workflows/spotify-sync/playlist-sync";
import {
	initialSync,
	incrementalSync,
	runPhase,
} from "@/lib/workflows/spotify-sync/sync-helpers";
import { getAuthSession } from "@/lib/platform/auth/auth.server";
import { validateApiToken } from "@/lib/data/api-tokens";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { createJob } from "@/lib/data/jobs";
import { updatePhaseJobIds } from "@/lib/domains/library/accounts/preferences-queries";
import { emitItem, emitStatus } from "@/lib/platform/jobs/progress/helpers";
import { completeJob } from "@/lib/platform/jobs/lifecycle";
import type { PhaseJobIds } from "@/lib/platform/jobs/progress/types";
import { runEnrichmentPipeline } from "@/lib/workflows/enrichment-pipeline/orchestrator";
import type { EnrichmentStageName } from "@/lib/workflows/enrichment-pipeline/types";
import type {
	SpotifyService,
	SpotifyTrackDTO,
	SpotifyPlaylistDTO,
} from "@/lib/integrations/spotify/service";

const SpotifyTrackDTOSchema = z.object({
	added_at: z.string(),
	track: z.object({
		id: z.string(),
		name: z.string(),
		artists: z.array(z.object({ id: z.string(), name: z.string() })),
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

const SyncPayloadSchema = z.object({
	likedSongs: z.array(SpotifyTrackDTOSchema),
	playlists: z.array(SpotifyPlaylistDTOSchema),
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
						const tokenResult = await validateApiToken(token);
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

						const accountUpdate: Record<string, string> = {};
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

				const likedSongs = payload.likedSongs as unknown as SpotifyTrackDTO[];
				const extensionPlaylists =
					payload.playlists as unknown as SpotifyPlaylistDTO[];

				// Create job records for SSE progress tracking
				const [songsJobResult, playlistsJobResult, tracksJobResult] =
					await Promise.all([
						createJob(accountId, "sync_liked_songs"),
						createJob(accountId, "sync_playlists"),
						createJob(accountId, "sync_playlist_tracks"),
					]);

				if (
					Result.isError(songsJobResult) ||
					Result.isError(playlistsJobResult) ||
					Result.isError(tracksJobResult)
				) {
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

				// Persist to DB so the web app can discover them via preferences
				const persistResult = await updatePhaseJobIds(accountId, phaseJobIds);
				if (Result.isError(persistResult)) {
					console.warn("Failed to persist phaseJobIds:", persistResult.error);
				}

				// Emit initial totals so subscribers see progress immediately
				emitItem(phaseJobIds.liked_songs, {
					itemId: "liked_songs",
					itemKind: "song",
					status: "in_progress",
					count: 0,
					total: likedSongs.length,
				});
				emitItem(phaseJobIds.playlists, {
					itemId: "playlists",
					itemKind: "playlist",
					status: "in_progress",
					count: 0,
					total: extensionPlaylists.length,
				});
				// Extension doesn't sync playlist tracks — emit total 0 for this phase
				emitItem(phaseJobIds.playlist_tracks, {
					itemId: "playlist_tracks",
					itemKind: "song",
					status: "in_progress",
					count: 0,
					total: 0,
				});

				const results: Record<string, unknown> = {};

				// Phase 1: Sync liked songs
				if (likedSongs.length > 0) {
					const songsResult = await runPhase(
						phaseJobIds.liked_songs,
						async () => {
							const existingResult = await likedSongData.getAll(accountId);
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

							if (Result.isOk(syncResult)) {
								emitItem(phaseJobIds.liked_songs, {
									itemId: "liked_songs",
									itemKind: "song",
									status: "succeeded",
									count: syncResult.value.total,
									total: likedSongs.length,
								});
							}

							return syncResult;
						},
					);

					if (Result.isError(songsResult)) {
						return Response.json(
							{
								error: `Liked songs sync failed: ${songsResult.error.message}`,
								phaseJobIds,
							},
							{ status: 500, headers: corsHeaders },
						);
					}

					results.likedSongs = {
						total: songsResult.value.total,
						added: songsResult.value.added,
						removed: songsResult.value.removed,
					};
				} else {
					// No liked songs to sync — immediately complete the phase
					emitItem(phaseJobIds.liked_songs, {
						itemId: "liked_songs",
						itemKind: "song",
						status: "succeeded",
						count: 0,
						total: 0,
					});
					emitStatus(phaseJobIds.liked_songs, "completed");
					await completeJob(phaseJobIds.liked_songs);
				}

				// Phase 2: Sync playlists
				if (extensionPlaylists.length > 0) {
					const playlistResult = await runPhase(
						phaseJobIds.playlists,
						async () => {
							const playlistSync = new PlaylistSyncService(
								null as unknown as SpotifyService,
							);
							const syncResult = await playlistSync.syncPlaylists(accountId, {
								cachedPlaylists: extensionPlaylists,
							});

							if (Result.isOk(syncResult)) {
								emitItem(phaseJobIds.playlists, {
									itemId: "playlists",
									itemKind: "playlist",
									status: "succeeded",
									count: syncResult.value.total,
									total: extensionPlaylists.length,
								});
							}

							return syncResult;
						},
					);

					if (Result.isError(playlistResult)) {
						return Response.json(
							{
								error: `Playlist sync failed: ${playlistResult.error.message}`,
								phaseJobIds,
							},
							{ status: 500, headers: corsHeaders },
						);
					}

					results.playlists = {
						total: playlistResult.value.total,
						created: playlistResult.value.created,
						updated: playlistResult.value.updated,
						removed: playlistResult.value.removed,
					};
				} else {
					emitItem(phaseJobIds.playlists, {
						itemId: "playlists",
						itemKind: "playlist",
						status: "succeeded",
						count: 0,
						total: 0,
					});
					emitStatus(phaseJobIds.playlists, "completed");
					await completeJob(phaseJobIds.playlists);
				}

				// Phase 3: Playlist tracks — extension doesn't sync these separately
				emitItem(phaseJobIds.playlist_tracks, {
					itemId: "playlist_tracks",
					itemKind: "song",
					status: "succeeded",
					count: 0,
					total: 0,
				});
				emitStatus(phaseJobIds.playlist_tracks, "completed");
				await completeJob(phaseJobIds.playlist_tracks);

				// Phase 4: Enrichment pipeline — auto-runs after sync completes
				let pipelineJobIds: Partial<
					Record<EnrichmentStageName, string>
				> | null = null;
				let pipeline: Record<string, unknown> | null = null;

				try {
					const pipelineResult = await runEnrichmentPipeline(accountId);

					if (Result.isOk(pipelineResult)) {
						const run = pipelineResult.value;
						pipelineJobIds = run.stageJobIds;
						pipeline = {
							stages: run.stages,
							totalDurationMs: run.totalDurationMs,
						};
					} else {
						console.error(
							"[sync] Pipeline bootstrap failed:",
							pipelineResult.error.message,
						);
						pipeline = { error: pipelineResult.error.message, stages: [] };
					}
				} catch (error) {
					console.error("[sync] Pipeline unexpected error:", error);
					pipeline = {
						error:
							error instanceof Error ? error.message : "Unknown pipeline error",
						stages: [],
					};
				}

				return Response.json(
					{ ok: true, results, phaseJobIds, pipelineJobIds, pipeline },
					{ headers: corsHeaders },
				);
			},
		},
	},
});

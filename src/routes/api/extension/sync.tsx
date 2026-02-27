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
 * Auth: Session cookie (same as the rest of the app)
 */

import { createFileRoute } from "@tanstack/react-router";
import { Result } from "better-result";
import { z } from "zod";
import * as likedSongData from "@/lib/data/liked-song";
import { PlaylistSyncService } from "@/lib/capabilities/sync/playlist-sync";
import {
	initialSync,
	incrementalSync,
} from "@/lib/capabilities/sync/sync-helpers";
import { getSession } from "@/lib/auth/session";
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
	track_count: z.number(),
	image_url: z.string().nullable(),
});

const SyncPayloadSchema = z.object({
	likedSongs: z.array(SpotifyTrackDTOSchema),
	playlists: z.array(SpotifyPlaylistDTOSchema),
});

export const Route = createFileRoute("/api/extension/sync")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const session = getSession(request);
				if (!session) {
					return Response.json({ error: "Not authenticated" }, { status: 401 });
				}

				let payload: z.infer<typeof SyncPayloadSchema>;
				try {
					const body = await request.json();
					payload = SyncPayloadSchema.parse(body);
				} catch {
					return Response.json({ error: "Invalid payload" }, { status: 400 });
				}

				const { accountId } = session;
				const results: Record<string, unknown> = {};

				// Zod-validated data is structurally compatible with backend DTOs
				// (only difference: image width/height optionality — sync only uses url)
				const likedSongs = payload.likedSongs as unknown as SpotifyTrackDTO[];
				const extensionPlaylists =
					payload.playlists as unknown as SpotifyPlaylistDTO[];

				// Sync liked songs (initial vs incremental based on existing data)
				if (likedSongs.length > 0) {
					const existingResult = await likedSongData.getAll(accountId);
					if (Result.isError(existingResult)) {
						return Response.json(
							{ error: "Failed to read existing liked songs" },
							{ status: 500 },
						);
					}

					const isInitial = existingResult.value.length === 0;
					const syncResult = isInitial
						? await initialSync(accountId, likedSongs)
						: await incrementalSync(accountId, {
								likedSongs,
								existingLikedSongs: existingResult.value,
								likedSongsIds: new Set(likedSongs.map((t) => t.track.id)),
							});

					if (Result.isError(syncResult)) {
						return Response.json(
							{ error: `Liked songs sync failed: ${syncResult.error.message}` },
							{ status: 500 },
						);
					}

					results.likedSongs = {
						total: syncResult.value.total,
						added: syncResult.value.added,
						removed: syncResult.value.removed,
					};
				}

				// Sync playlists (cached — no SpotifyService API calls needed)
				if (extensionPlaylists.length > 0) {
					const playlistSync = new PlaylistSyncService(
						null as unknown as SpotifyService,
					);
					const playlistResult = await playlistSync.syncPlaylists(accountId, {
						cachedPlaylists: extensionPlaylists,
					});

					if (Result.isError(playlistResult)) {
						return Response.json(
							{
								error: `Playlist sync failed: ${playlistResult.error.message}`,
							},
							{ status: 500 },
						);
					}

					results.playlists = {
						total: playlistResult.value.total,
						created: playlistResult.value.created,
						updated: playlistResult.value.updated,
						removed: playlistResult.value.removed,
					};
				}

				return Response.json({ ok: true, results });
			},
		},
	},
});

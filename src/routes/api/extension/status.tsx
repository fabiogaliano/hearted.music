/**
 * Extension Status API Route
 *
 * GET /api/extension/status
 *
 * Returns quick status for the Chrome extension to check whether
 * the user is authenticated and what data has been synced.
 *
 * Auth: Session cookie (returns unauthenticated status if missing)
 */

import { createFileRoute } from "@tanstack/react-router";
import { Result } from "better-result";
import * as likedSongData from "@/lib/data/liked-song";
import * as playlistData from "@/lib/data/playlists";
import { getSession } from "@/lib/auth/session";

export const Route = createFileRoute("/api/extension/status")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const session = getSession(request);
				if (!session) {
					return Response.json({
						authenticated: false,
						likedSongCount: 0,
						playlistCount: 0,
					});
				}

				const { accountId } = session;

				const [likedCountResult, playlistCountResult] = await Promise.all([
					likedSongData.getCount(accountId),
					playlistData.getPlaylistCount(accountId),
				]);

				return Response.json({
					authenticated: true,
					likedSongCount: Result.isOk(likedCountResult)
						? likedCountResult.value
						: 0,
					playlistCount: Result.isOk(playlistCountResult)
						? playlistCountResult.value
						: 0,
				});
			},
		},
	},
});

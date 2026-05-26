/**
 * Extension Status API Route
 *
 * GET /api/extension/status
 *
 * Returns quick status for the Chrome extension to check whether
 * the extension API token is valid and what data has been synced.
 *
 * Auth: Bearer token (extension API token)
 */

import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { getCount } from "@/lib/domains/library/liked-songs/queries";
import { getPlaylistCount } from "@/lib/domains/library/playlists/queries";
import { validateExtensionApiToken } from "@/lib/platform/auth/extension-api-tokens";
import {
	extensionCorsPreflightResponse,
	getExtensionCorsHeaders,
} from "@/lib/server/extension-cors";

export const Route = createFileRoute("/api/extension/status")({
	server: {
		handlers: {
			OPTIONS: async ({ request }) => extensionCorsPreflightResponse(request),
			GET: async () => {
				const request = getRequest();
				const corsHeaders = getExtensionCorsHeaders(request);
				const authHeader = request.headers.get("Authorization");

				if (!authHeader?.startsWith("Bearer ")) {
					return Response.json(
						{ authenticated: false, likedSongCount: 0, playlistCount: 0 },
						{ headers: corsHeaders },
					);
				}

				const token = authHeader.slice(7);
				const tokenResult = await validateExtensionApiToken(token);
				if (Result.isError(tokenResult) || !tokenResult.value) {
					return Response.json(
						{ error: "Invalid or revoked API token" },
						{ status: 401, headers: corsHeaders },
					);
				}

				const accountId = tokenResult.value;
				const supabase = createAdminSupabaseClient();
				const { data: account } = await supabase
					.from("account")
					.select("display_name, email")
					.eq("id", accountId)
					.single();

				const [likedCountResult, playlistCountResult] = await Promise.all([
					getCount(accountId),
					getPlaylistCount(accountId),
				]);

				return Response.json(
					{
						authenticated: true,
						accountId,
						displayName: account?.display_name ?? null,
						email: account?.email ?? null,
						likedSongCount: Result.isOk(likedCountResult)
							? likedCountResult.value
							: 0,
						playlistCount: Result.isOk(playlistCountResult)
							? playlistCountResult.value
							: 0,
					},
					{ headers: corsHeaders },
				);
			},
		},
	},
});

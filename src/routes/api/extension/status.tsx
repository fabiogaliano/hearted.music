/**
 * Extension Status API Route
 *
 * GET /api/extension/status
 *
 * Returns quick status for the Chrome extension to check whether
 * the user is authenticated and what data has been synced.
 *
 * Auth: Better Auth session cookie OR Bearer token (extension API token)
 */

import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import {
	extensionCorsPreflightResponse,
	getExtensionCorsHeaders,
} from "@/lib/server/extension-cors";
import { Result } from "better-result";
import * as likedSongData from "@/lib/data/liked-song";
import * as playlistData from "@/lib/data/playlists";
import { getAuthSession } from "@/lib/auth.server";
import { validateApiToken } from "@/lib/data/api-tokens";
import { createAdminSupabaseClient } from "@/lib/data/client";

export const Route = createFileRoute("/api/extension/status")({
	server: {
		handlers: {
			OPTIONS: async ({ request }) => extensionCorsPreflightResponse(request),
			GET: async () => {
				const request = getRequest();
				const corsHeaders = getExtensionCorsHeaders(request);
				let accountId: string | null = null;
				let displayName: string | null = null;
				let email: string | null = null;

				const authContext = await getAuthSession();
				if (authContext) {
					accountId = authContext.session.accountId;
					displayName = authContext.account?.display_name ?? null;
					email = authContext.account?.email ?? null;
				} else {
					const authHeader = request.headers.get("Authorization");
					if (authHeader?.startsWith("Bearer ")) {
						const token = authHeader.slice(7);
						const tokenResult = await validateApiToken(token);
						if (Result.isOk(tokenResult) && tokenResult.value) {
							accountId = tokenResult.value;
						} else {
							return Response.json(
								{ error: "Invalid or revoked API token" },
								{ status: 401, headers: corsHeaders },
							);
						}
					}
				}

				if (!accountId) {
					return Response.json(
						{ authenticated: false, likedSongCount: 0, playlistCount: 0 },
						{ headers: corsHeaders },
					);
				}

				if (!displayName && !email) {
					const supabase = createAdminSupabaseClient();
					const { data: account } = await supabase
						.from("account")
						.select("display_name, email")
						.eq("id", accountId)
						.single();
					if (account) {
						displayName = account.display_name;
						email = account.email;
					}
				}

				const [likedCountResult, playlistCountResult] = await Promise.all([
					likedSongData.getCount(accountId),
					playlistData.getPlaylistCount(accountId),
				]);

				return Response.json(
					{
						authenticated: true,
						accountId,
						displayName,
						email,
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

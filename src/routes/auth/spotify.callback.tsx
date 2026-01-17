/**
 * GET /auth/spotify/callback - Handles Spotify OAuth redirect
 *
 * Verifies state, exchanges code for tokens, creates/updates account,
 * and establishes session.
 *
 * Uses Result types at the route boundary to translate errors to redirects.
 */

import { Result } from "better-result";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import {
	clearOAuthCookies,
	getOAuthCookies,
	setSessionCookie,
} from "@/lib/auth/cookies";
import { upsertAccount } from "@/lib/data/accounts";
import { upsertToken } from "@/lib/data/auth-tokens";
import { exchangeCodeForTokens, fetchSpotifyUser } from "@/lib/services/spotify/client";

const callbackSearchSchema = z.object({
	code: z.string().optional(),
	state: z.string().optional(),
	error: z.string().optional(),
});

const handleCallback = createServerFn({ method: "GET" })
	.inputValidator(callbackSearchSchema)
	.handler(async ({ data }) => {
		const request = getRequest();

		try {
			// Handle Spotify errors (user denied access, etc.)
			if (data.error) {
				throw redirect({
					to: "/", search: { error: data.error },
				})
			}

			if (!data.code || !data.state) {
				throw redirect({
					to: "/",
					search: { error: "missing_params" },
				})
			}

			// Verify state matches
			const { state: storedState, codeVerifier } = getOAuthCookies(request);

			if (!storedState || storedState !== data.state) {
				throw redirect({
					to: "/",
					search: { error: "invalid_state" },
				})
			}

			if (!codeVerifier) {
				throw redirect({
					to: "/",
					search: { error: "missing_verifier" },
				})
			}

			// Exchange code for tokens
			const tokens = await exchangeCodeForTokens(data.code, codeVerifier);

			// Fetch user profile
			const spotifyUser = await fetchSpotifyUser(tokens.access_token);

			// Create or update account (Result-based)
			const accountResult = await upsertAccount({
				spotify_id: spotifyUser.id,
				email: spotifyUser.email,
				display_name: spotifyUser.display_name,
			});

			if (Result.isError(accountResult)) {
				throw redirect({
					to: "/",
					search: { error: `db_error:${accountResult.error._tag}` },
				});
			}
			const account = accountResult.value;

			// Store tokens (Result-based)
			const tokenResult = await upsertToken(account.id, {
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token,
				expires_in: tokens.expires_in,
			});

			if (Result.isError(tokenResult)) {
				throw redirect({
					to: "/",
					search: { error: `db_error:${tokenResult.error._tag}` },
				});
			}

			// Set session and clear OAuth cookies
			const sessionCookie = setSessionCookie(account.id);
			const clearCookies = clearOAuthCookies();

			// Set-Cookie headers must be separate (can't be comma-joined like other headers)
			const headers = new Headers();
			headers.append("Set-Cookie", sessionCookie);
			for (const cookie of clearCookies) {
				headers.append("Set-Cookie", cookie);
			}

			throw redirect({
				to: "/",
				headers,
			});
		} catch (error) {
			// Re-throw redirects (they're expected)
			if (error instanceof Response || (error as any)?.redirect) {
				throw error;
			}
			// Redirect with error message
			throw redirect({
				to: "/",
				search: { error: String(error) },
			});
		}
	})

export const Route = createFileRoute("/auth/spotify/callback")({
	validateSearch: callbackSearchSchema,
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) => handleCallback({ data: deps }),
});

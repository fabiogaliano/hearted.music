/**
 * GET /auth/spotify - Initiates Spotify OAuth flow
 *
 * Generates PKCE codes, stores them in cookies, and redirects to Spotify.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "@/env";
import { setOAuthCookies } from "@/lib/auth/cookies";
import {
	generateCodeChallenge,
	generateCodeVerifier,
	generateState,
} from "@/lib/auth/oauth";

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";

const SCOPES = [
	"user-read-private",
	"user-read-email",
	"user-library-read",
	"playlist-read-private",
	"playlist-modify-public",
	"playlist-modify-private",
].join(" ");

const initiateOAuth = createServerFn({ method: "GET" }).handler(async () => {
	const state = generateState();
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);

	const params = new URLSearchParams({
		response_type: "code",
		client_id: env.SPOTIFY_CLIENT_ID,
		scope: SCOPES,
		redirect_uri: env.SPOTIFY_REDIRECT_URI,
		state,
		code_challenge_method: "S256",
		code_challenge: codeChallenge,
	});

	const authUrl = `${SPOTIFY_AUTH_URL}?${params}`;
	const cookies = setOAuthCookies(state, codeVerifier);

	// Set-Cookie headers must be separate (can't be comma-joined like other headers)
	const headers = new Headers();
	for (const cookie of cookies) {
		headers.append("Set-Cookie", cookie);
	}

	throw redirect({
		href: authUrl,
		headers,
	});
});

export const Route = createFileRoute("/auth/spotify/")({
	loader: () => initiateOAuth(),
});

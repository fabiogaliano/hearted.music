/**
 * Spotify API client with automatic token refresh.
 *
 * Handles token expiry transparently - calling code doesn't need
 * to worry about refresh logic.
 *
 * Returns Result types for composable error handling.
 */

import { Result } from "better-result";
import { env } from "@/env";
import {
	type AuthToken,
	getTokenByAccountId,
	isTokenExpired,
	upsertToken,
} from "@/lib/data/auth-tokens";
import type { DbError } from "@/lib/shared/errors/database";
import { SpotifyAuthError } from "@/lib/shared/errors/external/spotify";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

/** Errors that can occur during token operations */
export type TokenError = DbError | SpotifyAuthError;

/** Per-account refresh promise map to dedupe concurrent refreshes. */
const refreshPromises = new Map<
	string,
	Promise<Result<AuthToken, TokenError>>
>();

export interface SpotifyUser {
	id: string;
	email: string;
	display_name: string;
	images: Array<{ url: string; width: number; height: number }>;
}

export interface SpotifyClient {
	getMe(): Promise<SpotifyUser>;
	fetch(path: string, init?: RequestInit): Promise<Response>;
}

/**
 * Gets a Spotify client for the given account.
 * Automatically refreshes the token if expired.
 */
export async function getSpotifyClient(
	accountId: string,
): Promise<Result<SpotifyClient, TokenError>> {
	const tokenResult = await getTokenByAccountId(accountId);

	if (Result.isError(tokenResult)) {
		return Result.err(tokenResult.error);
	}

	if (!tokenResult.value) {
		return Result.err(new SpotifyAuthError("invalid"));
	}

	let token: AuthToken = tokenResult.value;

	// Refresh if expired
	if (isTokenExpired(token)) {
		const refreshResult = await refreshTokenWithCoordination(accountId, token);
		if (Result.isError(refreshResult)) {
			return Result.err(refreshResult.error);
		}
		token = refreshResult.value;
	}

	return Result.ok(createClient(token.access_token));
}

/**
 * Refreshes an expired token with coordination to prevent duplicate refreshes.
 * For PKCE flow, only client_id is required (no client_secret).
 */
export async function refreshTokenWithCoordination(
	accountId: string,
	currentToken: AuthToken,
): Promise<Result<AuthToken, TokenError>> {
	const existingPromise = refreshPromises.get(accountId);
	if (existingPromise) {
		return existingPromise;
	}

	const refreshPromise = performTokenRefresh(accountId, currentToken).finally(
		() => {
			refreshPromises.delete(accountId);
		},
	);

	refreshPromises.set(accountId, refreshPromise);
	return refreshPromise;
}

/**
 * Refreshes an expired token and updates the database.
 * For PKCE flow, only client_id is required (no client_secret).
 */
async function performTokenRefresh(
	accountId: string,
	currentToken: AuthToken,
): Promise<Result<AuthToken, TokenError>> {
	const response = await fetch(SPOTIFY_TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: currentToken.refresh_token,
			client_id: env.SPOTIFY_CLIENT_ID,
		}),
	});

	if (!response.ok) {
		// Token refresh failed - likely revoked or expired refresh token
		return Result.err(new SpotifyAuthError("revoked"));
	}

	const data = await response.json();

	// Update tokens in database
	return upsertToken(accountId, {
		access_token: data.access_token,
		// Spotify may or may not return a new refresh token
		refresh_token: data.refresh_token || currentToken.refresh_token,
		expires_in: data.expires_in,
	});
}

/**
 * Creates a client instance with the given access token.
 */
function createClient(accessToken: string): SpotifyClient {
	const apiFetch = async (
		path: string,
		init?: RequestInit,
	): Promise<Response> => {
		const url = path.startsWith("http") ? path : `${SPOTIFY_API_BASE}${path}`;

		const response = await fetch(url, {
			...init,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
				...init?.headers,
			},
		});

		return response;
	};

	return {
		fetch: apiFetch,

		async getMe(): Promise<SpotifyUser> {
			const response = await apiFetch("/me");
			if (!response.ok) {
				throw new Error(`Spotify API error: ${response.status}`);
			}
			return response.json();
		},
	};
}

/**
 * Exchanges authorization code for tokens (used in callback).
 * Uses PKCE flow - no client_secret needed, only code_verifier.
 */
export async function exchangeCodeForTokens(
	code: string,
	codeVerifier: string,
): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const response = await fetch(SPOTIFY_TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: env.SPOTIFY_REDIRECT_URI,
			client_id: env.SPOTIFY_CLIENT_ID,
			code_verifier: codeVerifier,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Token exchange failed: ${error}`);
	}

	return response.json();
}

/**
 * Fetches Spotify user profile with a raw access token.
 * Used during OAuth callback before we have a full client.
 */
export async function fetchSpotifyUser(
	accessToken: string,
): Promise<SpotifyUser> {
	const response = await fetch(`${SPOTIFY_API_BASE}/me`, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch user: ${response.status}`);
	}

	return response.json();
}

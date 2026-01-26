/**
 * Spotify API client with automatic token refresh.
 *
 * Handles token expiry transparently - calling code doesn't need
 * to worry about refresh logic.
 *
 * Returns Result types for composable error handling.
 */

import { Result } from "better-result";
import { z } from "zod";
import { env } from "@/env";
import {
	type AuthToken,
	getTokenByAccountId,
	isTokenExpired,
	upsertToken,
} from "@/lib/data/auth-tokens";
import type { DbError } from "@/lib/shared/errors/database";
import { SpotifyApiError, SpotifyAuthError } from "@/lib/shared/errors/external/spotify";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

/** Spotify user response validation schema */
export const spotifyUserSchema = z.object({
	id: z.string(),
	email: z.email(),
	display_name: z.string().nullable(),
	images: z.array(
		z.object({
			url: z.url(),
			width: z.number(),
			height: z.number(),
		}),
	),
});

/** Spotify token refresh response validation schema */
const tokenRefreshResponseSchema = z.object({
	access_token: z.string(),
	token_type: z.string(),
	expires_in: z.number(),
	refresh_token: z.string().optional(),
	scope: z.string().optional(),
});

/** Errors that can occur during token operations */
export type TokenError = DbError | SpotifyAuthError | SpotifyApiError;

/** Per-account refresh promise map to dedupe concurrent refreshes. */
const refreshPromises = new Map<
	string,
	Promise<Result<AuthToken, TokenError>>
>();

export interface SpotifyUser {
	id: string;
	email: string;
	display_name: string | null;
	images: Array<{ url: string; width: number; height: number }>;
}

export interface SpotifyClient {
	getMe(): Promise<Result<SpotifyUser, SpotifyApiError>>;
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
	const parsed = tokenRefreshResponseSchema.safeParse(data);

	if (!parsed.success) {
		return Result.err(
			new SpotifyApiError({
				status: 500,
				message: `Invalid token refresh response: ${parsed.error.message}`,
			}),
		);
	}

	// Update tokens in database
	return upsertToken(accountId, {
		access_token: parsed.data.access_token,
		// Spotify may or may not return a new refresh token
		refresh_token: parsed.data.refresh_token || currentToken.refresh_token,
		expires_in: parsed.data.expires_in,
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

		async getMe(): Promise<Result<SpotifyUser, SpotifyApiError>> {
			const response = await apiFetch("/me");
			if (!response.ok) {
				return Result.err(
					new SpotifyApiError({
						status: response.status,
						message: `Failed to fetch user profile`,
					}),
				);
			}

			const data = await response.json();
			const parsed = spotifyUserSchema.safeParse(data);

			if (!parsed.success) {
				return Result.err(
					new SpotifyApiError({
						status: 500,
						message: `Invalid user profile response: ${parsed.error.message}`,
					}),
				);
			}

			return Result.ok(parsed.data);
		},
	};
}

/**
 * Exchanges authorization code for tokens (used in callback).
 * Uses PKCE flow - no client_secret needed, only code_verifier.
 * Returns Result type for composable error handling.
 */
export async function exchangeCodeForTokens(
	code: string,
	codeVerifier: string,
): Promise<
	Result<
		{
			access_token: string;
			refresh_token: string;
			expires_in: number;
		},
		SpotifyApiError | SpotifyAuthError
	>
> {
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
		if (response.status === 400 || response.status === 401) {
			return Result.err(new SpotifyAuthError("invalid"));
		}
		return Result.err(new SpotifyApiError({ status: response.status, message: "Token exchange failed" }));
	}

	const data = await response.json();
	const parsed = tokenRefreshResponseSchema.safeParse(data);
	if (!parsed.success) {
		return Result.err(
			new SpotifyApiError({
				status: 500,
				message: `Invalid token response: ${parsed.error.message}`,
			}),
		);
	}
	return Result.ok({
		access_token: parsed.data.access_token,
		refresh_token: parsed.data.refresh_token ?? "",
		expires_in: parsed.data.expires_in,
	});
}

/**
 * Fetches Spotify user profile with a raw access token.
 * Used during OAuth callback before we have a full client.
 * Returns Result type with Zod validation of response structure.
 */
export async function fetchSpotifyUser(
	accessToken: string,
): Promise<Result<SpotifyUser, SpotifyApiError | SpotifyAuthError>> {
	const response = await fetch(`${SPOTIFY_API_BASE}/me`, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});

	if (!response.ok) {
		if (response.status === 401) {
			return Result.err(new SpotifyAuthError("invalid"));
		}
		return Result.err(new SpotifyApiError({ status: response.status, message: "Failed to fetch user" }));
	}

	const data = await response.json();

	// Validate response structure with Zod
	const validation = spotifyUserSchema.safeParse(data);
	if (!validation.success) {
		return Result.err(
			new SpotifyApiError({ status: 500, message: "Invalid Spotify user response format" }),
		);
	}

	return Result.ok(validation.data);
}

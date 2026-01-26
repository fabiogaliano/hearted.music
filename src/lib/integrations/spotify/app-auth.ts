/**
 * Spotify App Authentication (Client Credentials Flow).
 *
 * Provides app-level access to Spotify APIs that don't require user scopes.
 * Token is cached in Supabase and automatically refreshed when expired.
 */

import { Result } from "better-result";
import { z } from "zod";
import { env } from "@/env";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	SpotifyAuthError,
	SpotifyApiError,
} from "@/lib/shared/errors/external/spotify";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

/** Zod schema for Spotify token response */
const SpotifyTokenResponseSchema = z.object({
	access_token: z.string(),
	token_type: z.literal("Bearer"),
	expires_in: z.number(),
});

/** Errors that can occur during app token operations */
export type AppTokenError = SpotifyAuthError | SpotifyApiError;

/**
 * Check if a token is expired (with 5 minute buffer).
 */
function isExpired(expiresAt: string): boolean {
	const expiryTime = new Date(expiresAt).getTime();
	const now = Date.now();
	const bufferMs = 5 * 60 * 1000; // 5 minutes
	return now >= expiryTime - bufferMs;
}

/**
 * Fetch a new app token from Spotify and store it in the database.
 */
async function fetchAndStoreAppToken(): Promise<
	Result<string, AppTokenError>
> {
	return Result.gen(async function* () {
		// Fetch token from Spotify
		const response = yield* Result.await(
			Result.tryPromise({
				try: () =>
					fetch(SPOTIFY_TOKEN_URL, {
						method: "POST",
						headers: {
							"Content-Type": "application/x-www-form-urlencoded",
							Authorization: `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
						},
						body: new URLSearchParams({
							grant_type: "client_credentials",
						}),
					}),
				catch: () =>
					new SpotifyApiError({ status: 0, message: "Network error" }),
			}),
		);

		if (!response.ok) {
			return Result.err(
				new SpotifyAuthError(
					response.status === 401 || response.status === 403
						? "invalid"
						: "expired",
				),
			);
		}

		const json = await response.json();
		const parsed = SpotifyTokenResponseSchema.safeParse(json);

		if (!parsed.success) {
			return Result.err(
				new SpotifyApiError({
					status: 200,
					message: "Invalid token response shape",
				}),
			);
		}

		const { access_token, expires_in } = parsed.data;
		const expiresAt = new Date(Date.now() + expires_in * 1000);

		// Store in database (upsert - handles both insert and update)
		const supabase = createAdminSupabaseClient();
		const { error } = await supabase
			.from("app_token")
			.upsert(
				{
					id: "00000000-0000-0000-0000-000000000000", // Fixed UUID for singleton
					access_token,
					token_expires_at: expiresAt.toISOString(),
					updated_at: new Date().toISOString(),
				},
				{
					onConflict: "id",
				},
			);

		if (error) {
			return Result.err(
				new SpotifyApiError({ status: 500, message: "Failed to store token" }),
			);
		}

		return Result.ok(access_token);
	});
}

/**
 * Get valid app token using Result.gen composition.
 * Reuses cached token if valid, fetches new one if expired.
 */
export function getAppToken(): Promise<Result<string, AppTokenError>> {
	return Result.gen(async function* () {
		const supabase = createAdminSupabaseClient();

		// Try cached token
		const { data: existing } = await supabase
			.from("app_token")
			.select("access_token, token_expires_at")
			.single();

		if (existing && !isExpired(existing.token_expires_at)) {
			return Result.ok(existing.access_token);
		}

		// Fetch new token
		const token = yield* Result.await(fetchAndStoreAppToken());
		return Result.ok(token);
	});
}

/**
 * Fetch from Spotify API using app-level authentication.
 * Automatically handles token acquisition and validation.
 */
export function appFetch<T>(
	path: string,
	schema: z.ZodType<T>,
): Promise<Result<T, AppTokenError>> {
	return Result.gen(async function* () {
		const token = yield* Result.await(getAppToken());

		const response = yield* Result.await(
			Result.tryPromise({
				try: () =>
					fetch(`${SPOTIFY_API_BASE}${path}`, {
						headers: { Authorization: `Bearer ${token}` },
					}),
				catch: () =>
					new SpotifyApiError({ status: 0, message: "Network error" }),
			}),
		);

		if (!response.ok) {
			return Result.err(
				new SpotifyApiError({
					status: response.status,
					message: `Spotify API error: ${response.status}`,
				}),
			);
		}

		const json = await response.json();
		const parsed = schema.safeParse(json);

		if (!parsed.success) {
			return Result.err(
				new SpotifyApiError({
					status: 200,
					message: "Invalid response shape",
				}),
			);
		}

		return Result.ok(parsed.data);
	});
}

/**
 * Spotify Service Module
 *
 * Entry point for Spotify API operations.
 * - Token refresh is handled by client.ts with Supabase storage
 * - SDK factory creates instances for API calls
 * - SpotifyService wraps SDK with retry + pagination
 * - Refresh coordination prevents duplicate token refreshes
 *
 * Returns Result types for composable error handling.
 */

import { Result } from "better-result";
import type { AuthToken } from "@/lib/data/auth-tokens";
import { getTokenByAccountId, isTokenExpired } from "@/lib/data/auth-tokens";
import type { DbError } from "@/lib/shared/errors/database";
import { SpotifyApiError, SpotifyAuthError } from "@/lib/shared/errors/external/spotify";
import { refreshTokenWithCoordination } from "./client";
import { createSpotifyApi } from "./sdk";
import { SpotifyService } from "./service";

/** Errors that can occur when initializing SpotifyService */
export type SpotifyServiceError = DbError | SpotifyAuthError | SpotifyApiError;

/**
 * Gets a SpotifyService instance for the given account.
 *
 * - Retrieves tokens from Supabase
 * - Refreshes if expired (with coordination to prevent duplicates)
 * - Creates SDK instance and wraps in SpotifyService
 *
 * @example
 * ```ts
 * const result = await getSpotifyService(accountId);
 * if (Result.isOk(result)) {
 *   const tracks = await result.value.getLikedTracks();
 * }
 * ```
 */
export async function getSpotifyService(
	accountId: string,
): Promise<Result<SpotifyService, SpotifyServiceError>> {
	const tokenResult = await getTokenByAccountId(accountId);

	if (Result.isError(tokenResult)) {
		return Result.err(tokenResult.error);
	}

	if (!tokenResult.value) {
		return Result.err(new SpotifyAuthError("invalid"));
	}

	let token: AuthToken = tokenResult.value;

	// Refresh if expired (with coordination)
	if (isTokenExpired(token)) {
		const refreshResult = await refreshTokenWithCoordination(accountId, token);
		if (Result.isError(refreshResult)) {
			return Result.err(refreshResult.error);
		}
		token = refreshResult.value;
	}

	const sdk = createSpotifyApi(token.access_token);
	return Result.ok(new SpotifyService(sdk));
}

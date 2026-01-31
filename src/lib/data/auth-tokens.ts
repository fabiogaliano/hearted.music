/**
 * Auth token data operations.
 *
 * Stores Spotify OAuth tokens server-side for security.
 * Uses service role client to bypass RLS.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Tables } from "./database.types";

/** Re-export for external use (e.g., spotify/client.ts needs this for isTokenExpired) */
export type AuthToken = Tables<"auth_token">;

/** Input data for upserting tokens (from Spotify OAuth response) */
export interface UpsertTokenData {
	access_token: string;
	refresh_token: string;
	expires_in: number; // seconds until expiry - converted to token_expires_at
}

/**
 * Gets the auth token for an account.
 * Returns null if not found (not an error).
 */
export function getTokenByAccountId(
	accountId: string,
): Promise<Result<AuthToken | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("auth_token")
			.select("*")
			.eq("account_id", accountId)
			.single(),
	);
}

/**
 * Creates or updates tokens for an account.
 * account_id has UNIQUE constraint, so this upserts.
 */
export function upsertToken(
	accountId: string,
	tokens: UpsertTokenData,
): Promise<Result<AuthToken, DbError>> {
	const supabase = createAdminSupabaseClient();

	// Calculate expiry timestamp
	const expiresAt = new Date(
		Date.now() + tokens.expires_in * 1000,
	).toISOString();

	return fromSupabaseSingle(
		supabase
			.from("auth_token")
			.upsert(
				{
					account_id: accountId,
					access_token: tokens.access_token,
					refresh_token: tokens.refresh_token,
					token_expires_at: expiresAt,
				},
				{ onConflict: "account_id" },
			)
			.select()
			.single(),
	);
}

/**
 * Deletes tokens for an account (used for logout/revocation).
 */
export async function deleteToken(
	accountId: string,
): Promise<Result<void, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { error } = await supabase
		.from("auth_token")
		.delete()
		.eq("account_id", accountId);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	return Result.ok(undefined);
}

/**
 * Checks if a token is expired (with 5 minute buffer).
 */
export function isTokenExpired(token: AuthToken): boolean {
	const expiresAt = new Date(token.token_expires_at).getTime();
	const bufferMs = 5 * 60 * 1000; // 5 minutes
	return Date.now() >= expiresAt - bufferMs;
}

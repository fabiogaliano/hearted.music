/**
 * Auth token data operations.
 *
 * Stores Spotify OAuth tokens server-side for security.
 * Uses service role client to bypass RLS.
 * Types are inferred from createClient<Database>() - no explicit annotations needed.
 */

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
 */
export async function getTokenByAccountId(accountId: string) {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("auth_token")
		.select("*")
		.eq("account_id", accountId)
		.single();

	if (error) {
		if (error.code === "PGRST116") return null; // Not found
		throw error;
	}
	return data;
}

/**
 * Creates or updates tokens for an account.
 * account_id has UNIQUE constraint, so this upserts.
 */
export async function upsertToken(accountId: string, tokens: UpsertTokenData) {
	const supabase = createAdminSupabaseClient();

	// Calculate expiry timestamp
	const expiresAt = new Date(
		Date.now() + tokens.expires_in * 1000,
	).toISOString();

	const { data, error } = await supabase
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
		.single();

	if (error) throw error;
	return data;
}

/**
 * Deletes tokens for an account (used for logout/revocation).
 */
export async function deleteToken(accountId: string): Promise<void> {
	const supabase = createAdminSupabaseClient();
	const { error } = await supabase
		.from("auth_token")
		.delete()
		.eq("account_id", accountId);

	if (error) throw error;
}

/**
 * Checks if a token is expired (with 5 minute buffer).
 */
export function isTokenExpired(token: AuthToken): boolean {
	const expiresAt = new Date(token.token_expires_at).getTime();
	const bufferMs = 5 * 60 * 1000; // 5 minutes
	return Date.now() >= expiresAt - bufferMs;
}

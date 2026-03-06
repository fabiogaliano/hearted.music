/**
 * API token data operations for extension bearer auth.
 *
 * Tokens are SHA-256 hashed before storage — plain tokens are only
 * returned once at generation time and never persisted.
 */

import { Result } from "better-result";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";

async function hashToken(token: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(token);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateRandomToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Generates a new API token for the given account.
 * Returns the plain token (only time it's available).
 */
export async function generateApiToken(
	accountId: string,
): Promise<Result<string, DbError>> {
	const plainToken = generateRandomToken();
	const tokenHash = await hashToken(plainToken);
	const supabase = createAdminSupabaseClient();

	const insertResult = await fromSupabaseSingle(
		supabase
			.from("api_token")
			.insert({
				account_id: accountId,
				token_hash: tokenHash,
				name: "extension",
			})
			.select()
			.single(),
	);

	if (Result.isError(insertResult)) {
		return insertResult;
	}

	return Result.ok(plainToken);
}

/**
 * Validates an API token by hashing and looking up in the database.
 * Updates last_used_at on successful validation.
 * Returns the accountId if valid, null if not found or revoked.
 */
export async function validateApiToken(
	token: string,
): Promise<Result<string | null, DbError>> {
	const tokenHash = await hashToken(token);
	const supabase = createAdminSupabaseClient();

	const result = await fromSupabaseMaybe(
		supabase
			.from("api_token")
			.select("id, account_id, revoked_at")
			.eq("token_hash", tokenHash)
			.is("revoked_at", null)
			.single(),
	);

	if (Result.isError(result)) return result;
	if (!result.value) return Result.ok(null);

	const { id, account_id } = result.value;

	await supabase
		.from("api_token")
		.update({ last_used_at: new Date().toISOString() })
		.eq("id", id);

	return Result.ok(account_id);
}

/**
 * Revokes a specific API token by setting revoked_at.
 */
export async function revokeApiToken(
	tokenId: string,
): Promise<Result<void, DbError>> {
	const supabase = createAdminSupabaseClient();

	const result = await fromSupabaseSingle(
		supabase
			.from("api_token")
			.update({ revoked_at: new Date().toISOString() })
			.eq("id", tokenId)
			.select()
			.single(),
	);

	if (Result.isError(result)) return result;
	return Result.ok(undefined);
}

/**
 * Revokes all API tokens for an account.
 */
export async function revokeAllTokensForAccount(
	accountId: string,
): Promise<Result<void, DbError>> {
	const supabase = createAdminSupabaseClient();

	const { error } = await supabase
		.from("api_token")
		.update({ revoked_at: new Date().toISOString() })
		.eq("account_id", accountId)
		.is("revoked_at", null);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(undefined);
}

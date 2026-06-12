/**
 * Extension API token data operations for extension bearer auth.
 *
 * Tokens are SHA-256 hashed before storage — plain tokens are only
 * returned once at generation time and never persisted.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { fromSupabaseSingle } from "@/lib/shared/utils/result-wrappers/supabase";

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
export async function createExtensionApiToken(
	accountId: string,
): Promise<Result<string, DbError>> {
	const plainToken = generateRandomToken();
	const tokenHash = await hashToken(plainToken);
	const supabase = createAdminSupabaseClient();

	const insertResult = await fromSupabaseSingle(
		supabase
			.from("extension_api_token")
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
 *
 * The lookup + last_used_at stamp are folded into the validate_extension_token
 * RPC (UPDATE ... RETURNING) so the CF Worker spends one subrequest instead of
 * a SELECT plus a fire-and-forget UPDATE.
 */
export async function validateExtensionApiToken(
	token: string,
): Promise<Result<string | null, DbError>> {
	const tokenHash = await hashToken(token);
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc("validate_extension_token", {
		p_token_hash: tokenHash,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(data ?? null);
}

/**
 * Revokes all API tokens for an account.
 */
export async function revokeExtensionApiTokensForAccount(
	accountId: string,
): Promise<Result<void, DbError>> {
	const supabase = createAdminSupabaseClient();

	const { error } = await supabase
		.from("extension_api_token")
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

/**
 * Account data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import type { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Tables, TablesInsert } from "./database.types";

/** Account row type */
export type Account = Tables<"account">;

/** Insert type - only the fields we use for upsert */
export type UpsertAccountData = Pick<
	TablesInsert<"account">,
	"spotify_id" | "email" | "display_name"
>;

/** Data for creating an account linked to a Better Auth user (no spotify_id yet) */
export interface CreateBetterAuthAccountData {
	better_auth_user_id: string;
	email: string;
	display_name: string;
}

/**
 * Gets an account by its UUID.
 * Returns null if not found (not an error).
 */
export function getAccountById(
	id: string,
): Promise<Result<Account | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase.from("account").select("*").eq("id", id).single(),
	);
}

/**
 * Gets an account by Spotify user ID.
 * Returns null if not found (not an error).
 */
export function getAccountBySpotifyId(
	spotifyId: string,
): Promise<Result<Account | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase.from("account").select("*").eq("spotify_id", spotifyId).single(),
	);
}

/**
 * Creates or updates an account based on Spotify ID.
 * Returns the account (existing or newly created).
 */
export function upsertAccount(
	data: UpsertAccountData,
): Promise<Result<Account, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("account")
			.upsert(
				{
					spotify_id: data.spotify_id,
					email: data.email,
					display_name: data.display_name,
				},
				{ onConflict: "spotify_id" },
			)
			.select()
			.single(),
	);
}

/**
 * Gets an account by its Better Auth user ID.
 * Used after Better Auth session validation to find our app account.
 */
export function getAccountByBetterAuthUserId(
	userId: string,
): Promise<Result<Account | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("account")
			.select("*")
			.eq("better_auth_user_id", userId)
			.single(),
	);
}

/**
 * Creates an account record linked to a Better Auth user.
 * Called from Better Auth's databaseHooks.user.create.after hook
 * on first social login. spotify_id is null until first extension sync.
 */
export async function createAccountForBetterAuthUser(
	data: CreateBetterAuthAccountData,
): Promise<Result<Account, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("account")
			.insert({
				better_auth_user_id: data.better_auth_user_id,
				email: data.email,
				display_name: data.display_name,
			})
			.select()
			.single(),
	);
}

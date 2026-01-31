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

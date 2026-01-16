/**
 * Account data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Types are inferred from createClient<Database>() - no explicit annotations needed.
 */

import { createAdminSupabaseClient } from "./client";
import type { TablesInsert } from "./database.types";

/** Insert type - only the fields we use for upsert */
export type UpsertAccountData = Pick<
	TablesInsert<"account">,
	"spotify_id" | "email" | "display_name"
>;

/**
 * Gets an account by its UUID.
 */
export async function getAccountById(id: string) {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("account")
		.select("*")
		.eq("id", id)
		.single();

	if (error) {
		if (error.code === "PGRST116") return null; // Not found
		throw error;
	}
	return data;
}

/**
 * Gets an account by Spotify user ID.
 */
export async function getAccountBySpotifyId(spotifyId: string) {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("account")
		.select("*")
		.eq("spotify_id", spotifyId)
		.single();

	if (error) {
		if (error.code === "PGRST116") return null; // Not found
		throw error;
	}
	return data;
}

/**
 * Creates or updates an account based on Spotify ID.
 * Returns the account (existing or newly created).
 */
export async function upsertAccount(data: UpsertAccountData) {
	const supabase = createAdminSupabaseClient();
	const { data: account, error } = await supabase
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
		.single();

	if (error) throw error;
	return account;
}

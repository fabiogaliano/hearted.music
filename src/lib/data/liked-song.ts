/**
 * Liked song and processing status operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/errors/data";
import {
	fromSupabaseMany,
	fromSupabaseSingle,
} from "@/lib/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Tables, TablesInsert } from "./database.types";
import type { ActionType } from "./newness";

// ============================================================================
// Type Exports
// ============================================================================

/** Liked song row type */
export type LikedSong = Tables<"liked_song">;

/** Item status row type (for tracking pending/processed state) */
export type ItemStatus = Tables<"item_status">;

/** Insert type for upserting liked songs */
export type UpsertData = Pick<TablesInsert<"liked_song">, "song_id" | "liked_at">;

// ============================================================================
// Query Operations
// ============================================================================

/**
 * Gets all liked songs for an account.
 * Returns empty array if none found.
 */
export function getAll(accountId: string): Promise<Result<LikedSong[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("liked_song")
			.select("*")
			.eq("account_id", accountId)
			.order("liked_at", { ascending: false }),
	);
}

/**
 * Gets liked songs that haven't been processed yet (no item_status record).
 * These are songs waiting for user action (add to playlist, dismiss, etc.).
 */
export async function getPending(
	accountId: string,
): Promise<Result<LikedSong[], DbError>> {
	const supabase = createAdminSupabaseClient();

	// Get all liked song IDs for this account
	const likedResult = await fromSupabaseMany(
		supabase.from("liked_song").select("*").eq("account_id", accountId),
	);

	if (Result.isError(likedResult)) {
		return likedResult;
	}

	const likedSongs = likedResult.value;
	if (likedSongs.length === 0) {
		return Result.ok<LikedSong[], DbError>([]);
	}

	// Get song IDs that have item_status records
	const songIds = likedSongs.map((ls: LikedSong) => ls.song_id);
	const statusResult = await fromSupabaseMany(
		supabase
			.from("item_status")
			.select("item_id")
			.eq("account_id", accountId)
			.eq("item_type", "song")
			.in("item_id", songIds),
	);

	if (Result.isError(statusResult)) {
		return Result.err(statusResult.error);
	}

	// Filter out songs that have status records
	const processedIds = new Set(
		statusResult.value.map((s: { item_id: string }) => s.item_id),
	);
	const pending = likedSongs.filter(
		(ls: LikedSong) => !processedIds.has(ls.song_id),
	);

	return Result.ok(pending);
}

// ============================================================================
// Mutation Operations
// ============================================================================

/**
 * Creates or updates liked songs for an account.
 * Uses (account_id, song_id) as the conflict target.
 * Returns all upserted liked songs.
 */
export function upsert(
	accountId: string,
	data: UpsertData[],
): Promise<Result<LikedSong[], DbError>> {
	if (data.length === 0) {
		return Promise.resolve(Result.ok<LikedSong[], DbError>([]));
	}
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("liked_song")
			.upsert(
				data.map((ls) => ({
					account_id: accountId,
					song_id: ls.song_id,
					liked_at: ls.liked_at,
				})),
				{ onConflict: "account_id,song_id" },
			)
			.select(),
	);
}

/**
 * Soft deletes a liked song for an account by setting unliked_at.
 * Preserves timeline history for analytics.
 */
export function softDelete(
	accountId: string,
	songId: string,
): Promise<Result<LikedSong, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("liked_song")
			.update({ unliked_at: new Date().toISOString() })
			.eq("account_id", accountId)
			.eq("song_id", songId)
			.select()
			.single(),
	);
}

/**
 * Updates the status of a liked song by creating/updating an item_status record.
 * Returns the created/updated item_status.
 */
export function updateStatus(
	accountId: string,
	songId: string,
	actionType: ActionType,
): Promise<Result<ItemStatus, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("item_status")
			.upsert(
				{
					account_id: accountId,
					item_id: songId,
					item_type: "song" as const,
					action_type: actionType,
					actioned_at: new Date().toISOString(),
					is_new: false,
				},
				{ onConflict: "account_id,item_id,item_type" },
			)
			.select()
			.single(),
	);
}

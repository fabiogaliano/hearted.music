/**
 * Item status tracking operations for newness/viewed/actioned state.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import { fromSupabaseMany } from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Enums, Tables, TablesInsert } from "@/lib/data/database.types";

// ============================================================================
// Type Exports
// ============================================================================

/** Item status row type */
export type ItemStatus = Tables<"item_status">;

/** Item type enum from database */
export type ItemType = Enums<"item_type">;

/** Counts of new items by type */
export type NewCounts = {
	song: number;
	playlist: number;
};

/** Insert type for item status */
export type UpsertItemStatus = Pick<
	TablesInsert<"item_status">,
	"account_id" | "item_id" | "item_type" | "is_new" | "viewed_at"
>;

// ============================================================================
// Query Operations
// ============================================================================

/**
 * Gets counts of new items for an account.
 * Returns counts for each item type (song, playlist).
 */
export async function getNewCounts(
	accountId: string,
): Promise<Result<NewCounts, DbError>> {
	const supabase = createAdminSupabaseClient();

	const result = await fromSupabaseMany(
		supabase
			.from("item_status")
			.select("item_type")
			.eq("account_id", accountId)
			.eq("is_new", true),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	// Count by item_type
	const counts: NewCounts = { song: 0, playlist: 0 };
	for (const item of result.value) {
		if (item.item_type === "song") {
			counts.song++;
		} else if (item.item_type === "playlist") {
			counts.playlist++;
		}
	}

	return Result.ok(counts);
}

/**
 * Gets IDs of new items for an account by type.
 * Returns array of item IDs (song or playlist UUIDs).
 */
export async function getNewItemIds(
	accountId: string,
	itemType: ItemType,
): Promise<Result<string[], DbError>> {
	const supabase = createAdminSupabaseClient();

	const result = await fromSupabaseMany(
		supabase
			.from("item_status")
			.select("item_id")
			.eq("account_id", accountId)
			.eq("item_type", itemType)
			.eq("is_new", true),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	return Result.ok(result.value.map((r) => r.item_id));
}

/**
 * Gets all item statuses for an account, optionally filtered by type.
 */
export function getItemStatuses(
	accountId: string,
	itemType?: ItemType,
): Promise<Result<ItemStatus[], DbError>> {
	const supabase = createAdminSupabaseClient();
	let query = supabase
		.from("item_status")
		.select("*")
		.eq("account_id", accountId)
		.order("created_at", { ascending: false });

	if (itemType) {
		query = query.eq("item_type", itemType);
	}

	return fromSupabaseMany(query);
}

// ============================================================================
// Mutation Operations
// ============================================================================

/**
 * Marks items as new (creates or updates item_status records).
 * Uses (account_id, item_id, item_type) as the conflict target.
 */
export function markItemsNew(
	accountId: string,
	itemType: ItemType,
	itemIds: string[],
): Promise<Result<ItemStatus[], DbError>> {
	if (itemIds.length === 0) {
		return Promise.resolve(Result.ok<ItemStatus[], DbError>([]));
	}

	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("item_status")
			.upsert(
				itemIds.map((itemId) => ({
					account_id: accountId,
					item_id: itemId,
					item_type: itemType,
					is_new: true,
				})),
				{ onConflict: "account_id,item_id,item_type" },
			)
			.select(),
	);
}

/**
 * Marks items as seen (viewed) by setting is_new=false and updating viewed_at.
 * Uses (account_id, item_id, item_type) as the conflict target.
 */
export function markSeen(
	accountId: string,
	itemType: ItemType,
	itemIds: string[],
): Promise<Result<ItemStatus[], DbError>> {
	if (itemIds.length === 0) {
		return Promise.resolve(Result.ok<ItemStatus[], DbError>([]));
	}

	const supabase = createAdminSupabaseClient();
	const now = new Date().toISOString();

	return fromSupabaseMany(
		supabase
			.from("item_status")
			.upsert(
				itemIds.map((itemId) => ({
					account_id: accountId,
					item_id: itemId,
					item_type: itemType,
					is_new: false,
					viewed_at: now,
				})),
				{ onConflict: "account_id,item_id,item_type" },
			)
			.select(),
	);
}

/**
 * Creates item_status rows marking items as pipeline-processed (is_new = false).
 * Does NOT set viewed_at — the user hasn't viewed these items.
 * Used by the enrichment pipeline to record that processing completed.
 */
export function markPipelineProcessed(
	accountId: string,
	itemType: ItemType,
	itemIds: string[],
): Promise<Result<ItemStatus[], DbError>> {
	if (itemIds.length === 0) {
		return Promise.resolve(Result.ok<ItemStatus[], DbError>([]));
	}

	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("item_status")
			.upsert(
				itemIds.map((itemId) => ({
					account_id: accountId,
					item_id: itemId,
					item_type: itemType,
					is_new: false,
				})),
				{
					onConflict: "account_id,item_id,item_type",
					ignoreDuplicates: true,
				},
			)
			.select(),
	);
}

/**
 * Marks all items of a type as seen for an account.
 * Returns the count of updated items.
 */
export async function markAllSeen(
	accountId: string,
	itemType: ItemType,
): Promise<Result<number, DbError>> {
	const supabase = createAdminSupabaseClient();
	const now = new Date().toISOString();

	const result = await fromSupabaseMany(
		supabase
			.from("item_status")
			.update({ is_new: false, viewed_at: now })
			.eq("account_id", accountId)
			.eq("item_type", itemType)
			.eq("is_new", true)
			.select(),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	return Result.ok(result.value.length);
}

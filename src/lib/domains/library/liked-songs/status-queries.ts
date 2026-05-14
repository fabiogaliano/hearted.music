/**
 * Item status tracking operations for newness/viewed/actioned state.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Enums, Tables } from "@/lib/data/database.types";
import type { DbError } from "@/lib/shared/errors/database";
import { fromSupabaseMany } from "@/lib/shared/utils/result-wrappers/supabase";

// ============================================================================
// Type Exports
// ============================================================================

/** Item status row type */
type ItemStatus = Tables<"item_status">;

/** Item type enum from database */
type ItemType = Enums<"item_type">;

// ============================================================================
// Query Operations
// ============================================================================

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

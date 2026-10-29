/**
 * Account item newness tracking operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Enums, Tables } from "@/lib/data/database.types";
import type { DbError } from "@/lib/shared/errors/database";
import { chunkedWrite } from "@/lib/shared/utils/chunked-write";
import {
	fromSupabaseMany,
	POSTGREST_MAX_ROWS,
} from "@/lib/shared/utils/result-wrappers/supabase";

// ============================================================================
// Type Exports
// ============================================================================

type AccountItemNewness = Tables<"account_item_newness">;

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

	const itemIds: string[] = [];
	// Keyset, not offset: viewing an item clears is_new, so a view between
	// pages would shift every later row back and an offset would skip one.
	// item_id is unique per (account_id, item_type).
	for (;;) {
		let query = supabase
			.from("account_item_newness")
			.select("item_id")
			.eq("account_id", accountId)
			.eq("item_type", itemType)
			.eq("is_new", true)
			.order("item_id")
			.limit(POSTGREST_MAX_ROWS);
		const after = itemIds.at(-1);
		if (after !== undefined) query = query.gt("item_id", after);

		const page = await fromSupabaseMany(query);
		if (Result.isError(page)) return Result.err(page.error);
		for (const row of page.value) itemIds.push(row.item_id);
		if (page.value.length < POSTGREST_MAX_ROWS) return Result.ok(itemIds);
	}
}

// ============================================================================
// Mutation Operations
// ============================================================================

/**
 * Marks items as new (creates or updates account_item_newness records).
 * Uses (account_id, item_id, item_type) as the conflict target.
 */
export function markItemsNew(
	accountId: string,
	itemType: ItemType,
	itemIds: string[],
): Promise<Result<AccountItemNewness[], DbError>> {
	if (itemIds.length === 0) {
		return Promise.resolve(Result.ok<AccountItemNewness[], DbError>([]));
	}

	const supabase = createAdminSupabaseClient();
	return chunkedWrite(itemIds, (chunk) =>
		fromSupabaseMany(
			supabase
				.from("account_item_newness")
				.upsert(
					chunk.map((itemId) => ({
						account_id: accountId,
						item_id: itemId,
						item_type: itemType,
						is_new: true,
					})),
					{ onConflict: "account_id,item_id,item_type" },
				)
				.select(),
		),
	);
}

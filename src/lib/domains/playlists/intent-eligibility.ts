/**
 * Intent-eligibility helpers for the playlist creation preview engine.
 *
 * The natural-language intent field is a premium feature. Eligibility is:
 *   hasUnlimitedAccess(billingState) OR unlockedSongCount >= 1000
 *
 * This is always computed server-side and never trusted from the client.
 */

import { createAdminSupabaseClient } from "@/lib/data/client";
import type { BillingState } from "@/lib/domains/billing/state";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";

const UNLOCK_THRESHOLD = 1000;

/**
 * Pure predicate: is this account eligible to use the intent field?
 *
 * Unlimited-access users always qualify. Free users qualify once they have
 * accumulated ≥ 1000 non-revoked unlocked songs — a meaningful signal that
 * they have engaged deeply enough to benefit from semantic search.
 */
export function isIntentEligible(
	billingState: BillingState,
	unlockedSongCount: number,
): boolean {
	return (
		hasUnlimitedAccess(billingState) || unlockedSongCount >= UNLOCK_THRESHOLD
	);
}

/**
 * Count non-revoked rows in account_song_unlock for the given account.
 *
 * A row counts as "unlocked" when revoked_at IS NULL. Revoked rows (pack
 * reversal, subscription lapse) must not inflate the count so a reverted
 * user cannot retain intent access based on stale rows.
 */
export async function getUnlockedSongCount(accountId: string): Promise<number> {
	const supabase = createAdminSupabaseClient();
	const { count, error } = await supabase
		.from("account_song_unlock")
		.select("*", { count: "exact", head: true })
		.eq("account_id", accountId)
		.is("revoked_at", null);

	if (error) {
		// Non-fatal: default to 0 so the intent field stays locked for uncertain
		// cases rather than accidentally granting access on error.
		console.error("[intent-eligibility] unlock count query failed:", error);
		return 0;
	}

	return count ?? 0;
}

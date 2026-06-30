import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import { grantFreeAllocation } from "@/lib/domains/billing/unlocks";
import { captureServerError } from "@/lib/observability/capture-server-error";
import type { DbError } from "@/lib/shared/errors/database";
import {
	completeOnboarding,
	type UserPreferences,
} from "./preferences-queries";

/**
 * True when the account already has a liked-song access grant row (pending or
 * applied). Row existence — not applied_at — gates the free allocation: the
 * 500-song benefit owns this account's unlocks, so the baseline free allocation
 * must be skipped even while the grant is still pending, to avoid stacking.
 *
 * Best-effort but fail-closed: on a read error we log and return true so we
 * skip the free allocation. The plan's invariant is "never stack the baseline
 * free allocation on top of this benefit", and on uncertainty preserving that
 * invariant is safer than granting extra access.
 */
async function hasLikedSongAccessGrant(
	supabase: AdminSupabaseClient,
	accountId: string,
): Promise<boolean> {
	const { data, error } = await supabase
		.from("account_liked_song_access_grant")
		.select("account_id")
		.eq("account_id", accountId)
		.maybeSingle();

	if (error) {
		console.error(
			"[onboarding] Failed to check liked-song access grant:",
			error.message,
		);
		return true;
	}

	return data !== null;
}

/**
 * Completes onboarding and, for free-plan accounts, grants the free song
 * allocation in one domain operation.
 *
 * Owning the composition here means every caller grants the allocation — when
 * the grant lived in the server-function handler, any other caller of
 * completeOnboarding silently skipped it.
 *
 * `ok(null)` propagates completeOnboarding's lost-race signal: another call
 * already completed onboarding, so this one must not run the allocation —
 * the winning call owns the side effects.
 *
 * The allocation is best-effort: a failed billing read or grant is logged but
 * never fails the operation, mirroring the prior handler behavior. Only the
 * completeOnboarding step's error is surfaced in the Result.
 */
export async function completeOnboardingWithAllocations(
	supabase: AdminSupabaseClient,
	accountId: string,
): Promise<Result<UserPreferences | null, DbError>> {
	const result = await completeOnboarding(accountId);
	if (Result.isError(result)) {
		return result;
	}
	if (result.value === null) {
		return result;
	}

	const billingResult = await readBillingState(supabase, accountId);

	if (Result.isOk(billingResult)) {
		const billing = billingResult.value;
		const isFree = billing.plan === "free" && !hasUnlimitedAccess(billing);

		if (isFree && !(await hasLikedSongAccessGrant(supabase, accountId))) {
			const allocationResult = await grantFreeAllocation(supabase, accountId);
			if (Result.isError(allocationResult)) {
				console.error(
					"[onboarding] Free allocation failed:",
					allocationResult.error,
				);
				// Free-plan user silently loses their baseline song allocation.
				captureServerError(allocationResult.error, {
					area: "onboarding",
					operation: "grant_free_allocation",
					accountId,
					extra: { stage: "grant_free_allocation" },
				});
			}
		}
	} else {
		console.error(
			"[onboarding] Failed to read billing state for free allocation:",
			billingResult.error,
		);
		// Cannot determine plan; free allocation is skipped for this account.
		captureServerError(billingResult.error, {
			area: "onboarding",
			operation: "onboarding_read_billing_state",
			accountId,
			extra: { stage: "read_billing_state" },
		});
	}

	return result;
}

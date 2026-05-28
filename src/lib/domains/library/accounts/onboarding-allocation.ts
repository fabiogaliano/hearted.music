import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import { grantFreeAllocation } from "@/lib/domains/billing/unlocks";
import type { DbError } from "@/lib/shared/errors/database";
import {
	completeOnboarding,
	type UserPreferences,
} from "./preferences-queries";

/**
 * Completes onboarding and, for free-plan accounts, grants the free song
 * allocation in one domain operation.
 *
 * Owning the composition here means every caller grants the allocation — when
 * the grant lived in the server-function handler, any other caller of
 * completeOnboarding silently skipped it.
 *
 * The allocation is best-effort: a failed billing read or grant is logged but
 * never fails the operation, mirroring the prior handler behavior. Only the
 * completeOnboarding step's error is surfaced in the Result.
 */
export async function completeOnboardingWithAllocations(
	supabase: AdminSupabaseClient,
	accountId: string,
): Promise<Result<UserPreferences, DbError>> {
	const result = await completeOnboarding(accountId);
	if (Result.isError(result)) {
		return result;
	}

	const billingResult = await readBillingState(supabase, accountId);

	if (Result.isOk(billingResult)) {
		const billing = billingResult.value;
		const isFree =
			billing.plan === "free" &&
			!hasUnlimitedAccess(billing) &&
			billing.creditBalance === 0;

		if (isFree) {
			const allocationResult = await grantFreeAllocation(supabase, accountId);
			if (Result.isError(allocationResult)) {
				console.error(
					"[onboarding] Free allocation failed:",
					allocationResult.error,
				);
			}
		}
	} else {
		console.error(
			"[onboarding] Failed to read billing state for free allocation:",
			billingResult.error,
		);
	}

	return result;
}

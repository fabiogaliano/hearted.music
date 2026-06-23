/**
 * Client-facing eligibility query for the intent field.
 *
 * Server fn + query options factory so the route loader can ensureQueryData
 * and the ConfigSurface can read it synchronously via useQuery.
 */

import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import {
	getUnlockedSongCount,
	isIntentEligible,
} from "@/lib/domains/playlists/intent-eligibility";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";

export const getIntentEligibility = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<boolean> => {
		const { accountId } = context.session;
		const supabase = createAdminSupabaseClient();

		const [billingResult, unlockedCount] = await Promise.all([
			readBillingState(supabase, accountId),
			getUnlockedSongCount(accountId),
		]);

		// On billing error, degrade to ineligible rather than accidentally granting access.
		if (Result.isError(billingResult)) return false;

		return isIntentEligible(billingResult.value, unlockedCount);
	});

const INTENT_ELIGIBILITY_KEY = ["playlist-intent-eligibility"] as const;

export function intentEligibilityQueryOptions() {
	return queryOptions({
		queryKey: INTENT_ELIGIBILITY_KEY,
		queryFn: () => getIntentEligibility(),
		// Eligibility shifts only when a subscription or large unlock event happens;
		// 5 minutes is safely long enough without staling the page.
		staleTime: 5 * 60_000,
	});
}

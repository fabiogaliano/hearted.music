/**
 * Client-facing eligibility query for the intent field.
 *
 * Server fn + query options factory so the route loader can ensureQueryData
 * and both the studio rail and the seed stage can read it synchronously via
 * useQuery. Returns the full gate (allowed + criteria) so the locked treatment
 * can say WHY it's locked; the studio collapses it to `.allowed` for
 * IntentEditor, while the seed stage renders the criteria.
 */

import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { readBillingStateOrFreeTier } from "@/lib/domains/billing/queries";
import {
	buildIntentGate,
	type IntentGateVM,
} from "@/lib/domains/playlists/intent-eligibility";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";

export const getIntentEligibility = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<IntentGateVM> => {
		const { accountId } = context.session;
		const supabase = createAdminSupabaseClient();

		// On billing error, readBillingStateOrFreeTier degrades to the free tier,
		// which buildIntentGate turns into a locked gate — never accidentally
		// granting access.
		const billingState = await readBillingStateOrFreeTier(
			supabase,
			accountId,
			"get_intent_eligibility",
		);

		return buildIntentGate(billingState);
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

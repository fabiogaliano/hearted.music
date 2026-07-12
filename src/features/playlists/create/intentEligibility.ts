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
import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import {
	buildIntentGate,
	type IntentGateVM,
} from "@/lib/domains/playlists/intent-eligibility";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";

// The gate shown when billing can't be resolved: locked, with the Backstage Pass
// path listed as unmet. Degrades to ineligible rather than accidentally granting
// access, while still naming the path to the user.
const LOCKED_GATE_FALLBACK: IntentGateVM = {
	allowed: false,
	criteria: [{ id: "backstage-pass", label: "Backstage Pass", met: false }],
};

export const getIntentEligibility = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<IntentGateVM> => {
		const { accountId } = context.session;
		const supabase = createAdminSupabaseClient();

		const billingResult = await readBillingState(supabase, accountId);

		// On billing error, degrade to a locked gate rather than accidentally granting access.
		if (Result.isError(billingResult)) return LOCKED_GATE_FALLBACK;

		return buildIntentGate(billingResult.value);
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

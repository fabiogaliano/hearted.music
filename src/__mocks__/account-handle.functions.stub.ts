/**
 * Ladle stub for @/lib/server/account-handle.functions.
 *
 * The real callables are TanStack server functions that RPC to Supabase, so
 * they can't run in Ladle. This stub returns a controllable availability result
 * so ClaimHandleStep stories can render every check/available/taken/error state.
 *
 * Stories MUST set the behavior during render (not in an effect): React Query
 * dispatches the availability fetch from the child's effect phase, which runs
 * before the parent's effects — so an effect-based set would land too late.
 */

import type {
	CheckHandleAvailabilityResult,
	ClaimHandleAndAdvanceResult,
} from "@/lib/server/account-handle.functions";

export type HandleAvailabilityBehavior =
	| "available"
	| "taken"
	| "profanity"
	| "error"
	// "checking" never settles, so the query stays in-flight and the step
	// holds the "Checking availability…" state.
	| "checking";

let behavior: HandleAvailabilityBehavior = "available";

export function setHandleAvailabilityBehavior(
	next: HandleAvailabilityBehavior,
) {
	behavior = next;
}

const never = <T>() => new Promise<T>(() => {});

export const checkHandleAvailability = (_opts: {
	data: { handle: string };
}): Promise<CheckHandleAvailabilityResult> => {
	if (behavior === "checking") return never<CheckHandleAvailabilityResult>();
	if (behavior === "taken")
		return Promise.resolve({ status: "unavailable", reason: "taken" });
	if (behavior === "profanity")
		return Promise.resolve({ status: "unavailable", reason: "profanity" });
	if (behavior === "error") return Promise.resolve({ status: "error" });
	return Promise.resolve({ status: "available" });
};

// Claiming never settles in Ladle: the "Submitting" story relies on the frozen
// in-flight state, and no other story triggers a submit. A resolved claim would
// also navigate via the StoryRouter catch-all to a blank route.
export const claimHandleAndAdvance = (_opts: {
	data: { handle: string };
}): Promise<ClaimHandleAndAdvanceResult> =>
	never<ClaimHandleAndAdvanceResult>();

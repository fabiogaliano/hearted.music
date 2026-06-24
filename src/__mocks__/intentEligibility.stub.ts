/**
 * Ladle stub for @/features/playlists/create/intentEligibility.
 *
 * The real module creates a server function that pulls auth middleware (and
 * therefore drizzle/postgres) into the graph. The stub exposes a controllable
 * boolean so stories can toggle premium vs free without hitting the server.
 */

import { queryOptions } from "@tanstack/react-query";

let _eligible = true;

export function setIntentEligible(eligible: boolean) {
	_eligible = eligible;
}

export const getIntentEligibility = () => Promise.resolve(_eligible);

const INTENT_ELIGIBILITY_KEY = ["playlist-intent-eligibility"] as const;

export function intentEligibilityQueryOptions() {
	return queryOptions({
		queryKey: INTENT_ELIGIBILITY_KEY,
		queryFn: () => getIntentEligibility(),
		staleTime: 5 * 60_000,
	});
}

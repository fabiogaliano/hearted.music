/**
 * Ladle stub for @/features/playlists/create/intentEligibility.
 *
 * The real module creates a server function that pulls auth middleware (and
 * therefore drizzle/postgres) into the graph. The stub exposes a controllable
 * intent gate so stories can toggle premium vs free without hitting the server.
 * The type is imported type-only so the domain module's runtime graph never
 * loads here.
 */

import { queryOptions } from "@tanstack/react-query";
import type { IntentGateVM } from "@/lib/domains/playlists/intent-eligibility";

function unlockedGate(): IntentGateVM {
	return {
		allowed: true,
		criteria: [{ id: "backstage-pass", label: "Backstage Pass", met: true }],
	};
}

function lockedGate(): IntentGateVM {
	return {
		allowed: false,
		criteria: [{ id: "backstage-pass", label: "Backstage Pass", met: false }],
	};
}

let _gate: IntentGateVM = unlockedGate();

/** Toggle the whole gate to a canned unlocked/locked shape. */
export function setIntentEligible(eligible: boolean) {
	_gate = eligible ? unlockedGate() : lockedGate();
}

/** Drive the gate precisely (e.g. a partial unlock progress) from a story. */
export function setIntentGate(gate: IntentGateVM) {
	_gate = gate;
}

export const getIntentEligibility = () => Promise.resolve(_gate);

const INTENT_ELIGIBILITY_KEY = ["playlist-intent-eligibility"] as const;

export function intentEligibilityQueryOptions() {
	return queryOptions({
		queryKey: INTENT_ELIGIBILITY_KEY,
		queryFn: () => getIntentEligibility(),
		staleTime: 5 * 60_000,
	});
}

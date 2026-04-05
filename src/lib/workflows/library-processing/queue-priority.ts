export type QueueBand = "low" | "standard" | "priority";

const BAND_VALUES: Record<QueueBand, number> = {
	low: 0,
	standard: 50,
	priority: 100,
};

export function bandToNumeric(band: QueueBand): number {
	return BAND_VALUES[band];
}

import type { BillingState } from "@/lib/domains/billing/state";

/**
 * Derives the queue band from resolved billing state.
 * Billing domain owns the band-derivation logic (BillingState.queueBand);
 * this is the scheduler-facing adapter that reads it.
 */
export function resolveQueuePriority(state: BillingState): QueueBand {
	return state.queueBand;
}

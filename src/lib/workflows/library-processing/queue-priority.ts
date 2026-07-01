import type { BillingState } from "@/lib/domains/billing/state";
import type { BillingBand, QueueBand } from "./band-policy";

const BAND_VALUES: Record<QueueBand, number> = {
	low: 0,
	standard: 50,
	priority: 100,
	interactive: 200,
};

export function bandToNumeric(band: QueueBand): number {
	return BAND_VALUES[band];
}

/**
 * Derives the queue band from resolved billing state.
 * Billing domain owns the band-derivation logic (BillingState.queueBand);
 * this is the scheduler-facing adapter that reads it.
 *
 * Returns BillingBand (never "interactive") because billing can't produce
 * that level — only scheduler-level policy can escalate to interactive.
 */
export function resolveQueuePriority(state: BillingState): BillingBand {
	return state.queueBand;
}

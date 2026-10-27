import { captureServerError } from "@/lib/observability/capture-server-error";
import { captureServerEvent } from "@/lib/observability/posthog-server";

/**
 * Best-effort product-event capture for server functions.
 *
 * A successful DB write must never be turned into a user-visible failure by an
 * analytics hiccup, so this never throws: a config failure in the PostHog
 * client is routed to Sentry via `captureServerError` instead of propagating.
 * Callers keep their control flow unchanged — a save, queue open, etc. still
 * returns success whether analytics succeeds or fails.
 */
export function captureProductEventBestEffort(args: {
	distinctId: string;
	event: string;
	properties?: Record<string, unknown>;
	accountId: string;
	/** Stable identifier for the capture call site, e.g. "capture_match_intent_set". */
	operation: string;
}): void {
	try {
		captureServerEvent({
			distinctId: args.distinctId,
			event: args.event,
			properties: args.properties,
		});
	} catch (error) {
		captureServerError(error, {
			area: "analytics",
			operation: args.operation,
			accountId: args.accountId,
			extra: { event: args.event },
		});
	}
}

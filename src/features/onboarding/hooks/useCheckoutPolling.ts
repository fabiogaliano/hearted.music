/**
 * Post-checkout polling hook.
 *
 * Given a typed checkout intent, polls getBillingState until the shared
 * fulfillment helper confirms the purchase landed, or a timeout elapses.
 * Stripe webhook retry (up to 3 days) handles late webhook delivery.
 */

import { useEffect, useState } from "react";
import { isCheckoutFulfilled } from "@/features/billing/checkout-fulfillment";
import type { CheckoutIntent } from "@/features/onboarding/checkout-intent";
import type { BillingState } from "@/lib/domains/billing/state";
import { getBillingState } from "@/lib/server/billing.functions";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000;

export type CheckoutPollingState =
	| { status: "polling" }
	| { status: "confirmed"; billingState: BillingState }
	| { status: "timeout" };

export function useCheckoutPolling(
	intent: CheckoutIntent | null,
): CheckoutPollingState | null {
	const [state, setState] = useState<CheckoutPollingState | null>(null);

	useEffect(() => {
		if (!intent) {
			setState(null);
			return;
		}

		setState({ status: "polling" });
		let cancelled = false;
		const startTime = Date.now();

		const poll = async () => {
			if (cancelled) return;

			try {
				const billing = await getBillingState();
				if (cancelled) return;

				if (isCheckoutFulfilled(intent, billing)) {
					setState({ status: "confirmed", billingState: billing });
					return;
				}
			} catch {
				// Ignore individual poll errors; keep trying until timeout
			}

			if (cancelled) return;

			if (Date.now() - startTime >= POLL_TIMEOUT_MS) {
				setState({ status: "timeout" });
				return;
			}

			timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);
		};

		let timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);

		return () => {
			cancelled = true;
			clearTimeout(timeoutId);
		};
	}, [intent]);

	return state;
}

/**
 * Post-checkout polling hook.
 *
 * After Stripe redirects back, polls getBillingState until the expected
 * billing change is detected or a timeout is reached. Stripe webhook
 * retry (up to 3 days) handles late delivery.
 */

import { useEffect, useRef, useState } from "react";
import type { BillingState } from "@/lib/domains/billing/state";
import type {
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
} from "@/lib/domains/billing/offers";
import { getBillingState } from "@/lib/server/billing.functions";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000;

type CheckoutOffer =
	| typeof SONG_PACK_500
	| typeof UNLIMITED_QUARTERLY
	| typeof UNLIMITED_YEARLY;

export type CheckoutPollingState =
	| { status: "polling" }
	| { status: "confirmed"; billingState: BillingState }
	| { status: "timeout" };

function isCheckoutFulfilled(
	offer: CheckoutOffer,
	state: BillingState,
): boolean {
	switch (offer) {
		case "song_pack_500":
			return state.creditBalance > 0;
		case "unlimited_quarterly":
		case "unlimited_yearly":
			return state.unlimitedAccess.kind === "subscription";
	}
}

export function useCheckoutPolling(
	offer: CheckoutOffer | null,
): CheckoutPollingState | null {
	const [state, setState] = useState<CheckoutPollingState | null>(null);
	const offerRef = useRef(offer);
	offerRef.current = offer;

	useEffect(() => {
		if (!offer) {
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

				if (isCheckoutFulfilled(offer, billing)) {
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
	}, [offer]);

	return state;
}

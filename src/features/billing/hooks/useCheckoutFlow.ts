/**
 * Hook for initiating checkout sessions from paywall CTAs.
 *
 * Saves a typed checkout intent to sessionStorage before redirecting to
 * Stripe. Pack intents capture the current credit balance as a baseline so
 * post-purchase fulfillment can distinguish a new purchase from residual
 * credit. Unlimited intents only carry the offer.
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { SONG_PACK_500 } from "@/lib/domains/billing/offers";
import type { BillingState } from "@/lib/domains/billing/state";
import { createCheckoutSession } from "@/lib/server/billing.functions";
import {
	saveCheckoutIntent,
	type CheckoutIntent,
	type CheckoutOffer,
} from "@/features/onboarding/checkout-intent";

type CheckoutFlowState =
	| { status: "idle" }
	| { status: "creating"; offer: CheckoutOffer }
	| { status: "redirecting"; offer: CheckoutOffer };

export function useCheckoutFlow(billingState: BillingState) {
	const [state, setState] = useState<CheckoutFlowState>({ status: "idle" });

	const startCheckout = useCallback(
		async (offer: CheckoutOffer) => {
			if (state.status !== "idle") return;

			setState({ status: "creating", offer });

			const checkoutAttemptId = crypto.randomUUID();
			const intent: CheckoutIntent =
				offer === SONG_PACK_500
					? {
							kind: "pack",
							offer,
							checkoutAttemptId,
							baselineCreditBalance: billingState.creditBalance,
						}
					: { kind: "unlimited", offer, checkoutAttemptId };
			saveCheckoutIntent(intent);

			try {
				const result = await createCheckoutSession({
					data: { offer, checkoutAttemptId },
				});

				if (result.success) {
					setState({ status: "redirecting", offer });
					window.location.href = result.checkoutUrl;
					return;
				}

				const message =
					result.error === "billing_disabled"
						? "Billing is not available right now."
						: result.error === "invalid_offer"
							? "Invalid plan selected."
							: "message" in result
								? result.message
								: "Something went wrong. Please try again.";
				toast.error(message);
			} catch {
				toast.error("Failed to start checkout. Please try again.");
			}

			setState({ status: "idle" });
		},
		[state.status, billingState.creditBalance],
	);

	const isBusy = state.status !== "idle";

	return { state, startCheckout, isBusy };
}

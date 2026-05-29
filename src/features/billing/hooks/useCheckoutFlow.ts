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
import { checkoutErrorMessage } from "@/features/billing/error-copy";
import {
	type CheckoutIntent,
	type CheckoutOffer,
	clearCheckoutIntent,
	saveCheckoutIntent,
} from "@/features/onboarding/checkout-intent";
import { SONG_PACK_500 } from "@/lib/domains/billing/offers";
import type { BillingState } from "@/lib/domains/billing/state";
import { parseStripeCheckoutUrl } from "@/lib/domains/billing/stripe-redirects";
import { createCheckoutSession } from "@/lib/server/billing.functions";

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

			try {
				const result = await createCheckoutSession({
					data: { offer, checkoutAttemptId },
				});

				if (result.success) {
					const safeUrl = parseStripeCheckoutUrl(result.checkoutUrl);
					if (safeUrl) {
						saveCheckoutIntent(intent);
						setState({ status: "redirecting", offer });
						window.location.href = safeUrl;
						return;
					}
					toast.error(checkoutErrorMessage("invalid_billing_redirect"));
				} else {
					toast.error(checkoutErrorMessage(result.error));
				}
			} catch {
				toast.error("Failed to start checkout. Please try again.");
			}

			clearCheckoutIntent();
			setState({ status: "idle" });
		},
		[state.status, billingState.creditBalance],
	);

	const isBusy = state.status !== "idle";

	return { state, startCheckout, isBusy };
}

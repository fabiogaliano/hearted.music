/**
 * Hook for initiating checkout sessions from paywall CTAs.
 *
 * Saves checkout intent to sessionStorage before redirecting to Stripe,
 * so usePostPurchaseReturn can detect the return and invalidate caches.
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type {
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
} from "@/lib/domains/billing/offers";
import { createCheckoutSession } from "@/lib/server/billing.functions";
import { saveCheckoutIntent } from "@/features/onboarding/checkout-intent";

type CheckoutOffer =
	| typeof SONG_PACK_500
	| typeof UNLIMITED_QUARTERLY
	| typeof UNLIMITED_YEARLY;

type CheckoutFlowState =
	| { status: "idle" }
	| { status: "creating"; offer: CheckoutOffer }
	| { status: "redirecting"; offer: CheckoutOffer };

export function useCheckoutFlow() {
	const [state, setState] = useState<CheckoutFlowState>({ status: "idle" });

	const startCheckout = useCallback(
		async (offer: CheckoutOffer) => {
			if (state.status !== "idle") return;

			setState({ status: "creating", offer });

			const checkoutAttemptId = crypto.randomUUID();
			saveCheckoutIntent({ offer, checkoutAttemptId });

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
		[state.status],
	);

	const isBusy = state.status !== "idle";

	return { state, startCheckout, isBusy };
}

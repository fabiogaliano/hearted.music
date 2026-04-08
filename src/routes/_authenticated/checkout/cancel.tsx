/**
 * /checkout/cancel — Stripe redirects here when the user cancels checkout.
 *
 * Clears the stale checkout intent from sessionStorage so the layout-level
 * usePostPurchaseReturn hook doesn't poll for a fulfillment that won't come,
 * then navigates to the dashboard.
 */

import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { clearCheckoutIntent } from "@/features/onboarding/checkout-intent";

export const Route = createFileRoute("/_authenticated/checkout/cancel")({
	component: CheckoutCancelPage,
});

function CheckoutCancelPage() {
	const navigate = useNavigate();

	useEffect(() => {
		clearCheckoutIntent();
		navigate({ to: "/dashboard", replace: true });
	}, [navigate]);

	return null;
}

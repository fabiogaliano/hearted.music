/**
 * /checkout/success — Post-purchase confirmation page.
 *
 * Stripe redirects here after a successful checkout. The layout-level
 * usePostPurchaseReturn hook handles polling the billing state until
 * the webhook is processed. This page watches the query cache and
 * transitions from a pending state to a confirmation once fulfilled.
 */

import { ArrowRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { isCheckoutFulfilled } from "@/features/billing/checkout-fulfillment";
import { billingKeys } from "@/features/billing/query-keys";
import type { CheckoutIntent } from "@/features/onboarding/checkout-intent";
import { loadCheckoutIntent } from "@/features/onboarding/checkout-intent";
import type { BillingState } from "@/lib/domains/billing/state";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import { useAnalytics } from "@/lib/observability/useAnalytics";
import { getBillingState } from "@/lib/server/billing.functions";
import { fonts } from "@/lib/theme/fonts";

export const Route = createFileRoute("/_authenticated/checkout/success")({
	component: CheckoutSuccessPage,
});

const TIMEOUT_MS = 35_000;

function getHeadline(
	intent: CheckoutIntent | null,
	state: BillingState,
): { text: string; accent: string } {
	if (intent?.kind === "pack") {
		return { text: "your songs are", accent: "waiting" };
	}
	if (intent?.kind === "unlimited" || hasUnlimitedAccess(state)) {
		return { text: "unlimited, all", accent: "yours" };
	}
	return { text: "you're all", accent: "set" };
}

function getDetail(intent: CheckoutIntent | null, state: BillingState): string {
	if (intent?.kind === "pack") {
		return `${String(state.creditBalance)} songs ready to explore.`;
	}
	if (intent?.kind === "unlimited" || hasUnlimitedAccess(state)) {
		return "Every song in your library is ready to explore.";
	}
	return "Your purchase has been confirmed.";
}

function CheckoutSuccessPage() {
	const contextBilling = Route.useRouteContext().billingState;
	const analytics = useAnalytics();

	const [intent, setIntent] = useState<CheckoutIntent | null>(null);
	const [hasHydrated, setHasHydrated] = useState(false);
	const [timedOut, setTimedOut] = useState(false);

	const { data: billingState = contextBilling } = useQuery({
		queryKey: billingKeys.state,
		queryFn: () => getBillingState(),
	});

	useEffect(() => {
		setIntent(loadCheckoutIntent());
		setHasHydrated(true);
	}, []);

	const confirmed =
		intent !== null && isCheckoutFulfilled(intent, billingState);

	const capturedRef = useRef(false);
	useEffect(() => {
		if (!confirmed || capturedRef.current) return;
		capturedRef.current = true;
		analytics.capture("purchase_confirmed", {
			plan_kind: intent?.kind,
			offer: intent?.offer,
		});
	}, [confirmed, intent, analytics]);
	const pending = intent !== null && !confirmed && !timedOut;

	useEffect(() => {
		if (confirmed || !intent) return;

		const id = window.setTimeout(() => setTimedOut(true), TIMEOUT_MS);
		return () => clearTimeout(id);
	}, [confirmed, intent]);

	if (!hasHydrated || pending) {
		return (
			<div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
				<p className="theme-primary animate-pulse text-2xl">♡</p>

				<h1
					className="theme-text mt-6 text-4xl leading-tight font-extralight md:text-5xl"
					style={{ fontFamily: fonts.display }}
				>
					one <span className="italic">moment</span>...
				</h1>

				<p
					className="theme-text-muted mt-4 text-sm"
					style={{ fontFamily: fonts.body }}
				>
					Confirming your purchase
				</p>
			</div>
		);
	}

	if (timedOut && !confirmed) {
		return (
			<div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
				<p className="theme-primary text-2xl">♡</p>

				<h1
					className="theme-text mt-6 text-4xl leading-tight font-extralight md:text-5xl"
					style={{ fontFamily: fonts.display }}
				>
					almost <span className="italic">there</span>
				</h1>

				<p
					className="theme-text-muted mt-4 text-center text-sm leading-relaxed"
					style={{ fontFamily: fonts.body }}
				>
					Taking a bit longer than usual.
					<br />
					Your payment went through, we're just catching up.
				</p>

				<Link
					to="/dashboard"
					className="theme-text group mt-8 inline-flex items-center gap-2 transition-opacity duration-200 hover:opacity-70"
					style={{ fontFamily: fonts.body }}
				>
					<span className="text-sm font-medium tracking-widest uppercase">
						Back to dashboard
					</span>
					<ArrowRightIcon
						size={14}
						className="inline-block transition-transform duration-200 group-hover:translate-x-1"
						style={{ opacity: 0.7 }}
					/>
				</Link>
			</div>
		);
	}

	const headline = getHeadline(intent, billingState);
	const detail = getDetail(intent, billingState);

	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
			<p className="theme-primary text-2xl">♡</p>

			<h1
				className="theme-text mt-6 text-4xl leading-tight font-extralight md:text-5xl"
				style={{ fontFamily: fonts.display }}
			>
				{headline.text} <span className="italic">{headline.accent}</span>
			</h1>

			<p
				className="theme-text-muted mt-4 text-sm"
				style={{ fontFamily: fonts.body }}
			>
				{detail}
			</p>

			<Link
				to="/dashboard"
				className="theme-text group mt-8 inline-flex items-center gap-2 transition-opacity duration-200 hover:opacity-70"
				style={{ fontFamily: fonts.body }}
			>
				<span className="text-sm font-medium tracking-widest uppercase">
					Start exploring
				</span>
				<ArrowRightIcon
					size={14}
					className="inline-block transition-transform duration-200 group-hover:translate-x-1"
					style={{ opacity: 0.7 }}
				/>
			</Link>
		</div>
	);
}

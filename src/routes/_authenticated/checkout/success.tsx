/**
 * /checkout/success — Post-purchase confirmation page.
 *
 * Stripe redirects here after a successful checkout. The layout-level
 * usePostPurchaseReturn hook handles polling the billing state until
 * the webhook is processed. This page watches the query cache and
 * transitions from a pending state to a confirmation once fulfilled.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { billingKeys } from "@/features/billing/query-keys";
import { loadCheckoutIntent } from "@/features/onboarding/checkout-intent";
import type { CheckoutIntent } from "@/features/onboarding/checkout-intent";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import type { BillingState } from "@/lib/domains/billing/state";
import { getBillingState } from "@/lib/server/billing.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

export const Route = createFileRoute("/_authenticated/checkout/success")({
	component: CheckoutSuccessPage,
});

const TIMEOUT_MS = 35_000;

function isFulfilled(offer: string, state: BillingState): boolean {
	switch (offer) {
		case "song_pack_500":
			return state.creditBalance > 0;
		case "unlimited_quarterly":
		case "unlimited_yearly":
			return state.unlimitedAccess.kind === "subscription";
		default:
			return false;
	}
}

function getHeadline(
	intent: CheckoutIntent | null,
	state: BillingState,
): { text: string; accent: string } {
	if (
		intent?.offer === "song_pack_500" ||
		(!intent && state.creditBalance > 0 && !hasUnlimitedAccess(state))
	) {
		return { text: "your songs are", accent: "waiting" };
	}
	if (hasUnlimitedAccess(state)) {
		return { text: "unlimited, all", accent: "yours" };
	}
	return { text: "you're all", accent: "set" };
}

function getDetail(intent: CheckoutIntent | null, state: BillingState): string {
	if (
		intent?.offer === "song_pack_500" ||
		(!intent && state.creditBalance > 0 && !hasUnlimitedAccess(state))
	) {
		return `${String(state.creditBalance)} songs ready to explore.`;
	}
	if (hasUnlimitedAccess(state)) {
		return "Every song in your library is ready to explore.";
	}
	return "Your purchase has been confirmed.";
}

function CheckoutSuccessPage() {
	const theme = useTheme();
	const contextBilling = Route.useRouteContext().billingState;

	const [intent] = useState(() => loadCheckoutIntent());
	const [timedOut, setTimedOut] = useState(false);

	const { data: billingState = contextBilling } = useQuery({
		queryKey: billingKeys.state,
		queryFn: () => getBillingState(),
	});

	const confirmed = intent !== null && isFulfilled(intent.offer, billingState);
	const pending = intent !== null && !confirmed && !timedOut;

	useEffect(() => {
		if (confirmed || !intent) return;

		const id = window.setTimeout(() => setTimedOut(true), TIMEOUT_MS);
		return () => clearTimeout(id);
	}, [confirmed, intent]);

	if (pending) {
		return (
			<div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
				<p className="animate-pulse text-2xl" style={{ color: theme.primary }}>
					♡
				</p>

				<h1
					className="mt-6 text-4xl leading-tight font-extralight md:text-5xl"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					one <span className="italic">moment</span>...
				</h1>

				<p
					className="mt-4 text-sm"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Confirming your purchase
				</p>
			</div>
		);
	}

	if (timedOut && !confirmed) {
		return (
			<div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
				<p className="text-2xl" style={{ color: theme.primary }}>
					♡
				</p>

				<h1
					className="mt-6 text-4xl leading-tight font-extralight md:text-5xl"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					almost <span className="italic">there</span>
				</h1>

				<p
					className="mt-4 text-center text-sm leading-relaxed"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Taking a bit longer than usual.
					<br />
					Your payment went through, we're just catching up.
				</p>

				<Link
					to="/dashboard"
					className="group mt-8 inline-flex items-center gap-2 transition-opacity duration-200 hover:opacity-80"
					style={{ fontFamily: fonts.body, color: theme.text }}
				>
					<span className="text-sm font-medium tracking-widest uppercase">
						Back to dashboard
					</span>
					<span
						className="inline-block transition-transform duration-200 group-hover:translate-x-1"
						style={{ opacity: 0.7 }}
					>
						→
					</span>
				</Link>
			</div>
		);
	}

	const headline = getHeadline(intent, billingState);
	const detail = getDetail(intent, billingState);

	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
			<p className="text-2xl" style={{ color: theme.primary }}>
				♡
			</p>

			<h1
				className="mt-6 text-4xl leading-tight font-extralight md:text-5xl"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				{headline.text} <span className="italic">{headline.accent}</span>
			</h1>

			<p
				className="mt-4 text-sm"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				{detail}
			</p>

			<Link
				to="/dashboard"
				className="group mt-8 inline-flex items-center gap-2 transition-opacity duration-200 hover:opacity-80"
				style={{ fontFamily: fonts.body, color: theme.text }}
			>
				<span className="text-sm font-medium tracking-widest uppercase">
					Start exploring
				</span>
				<span
					className="inline-block transition-transform duration-200 group-hover:translate-x-1"
					style={{ opacity: 0.7 }}
				>
					→
				</span>
			</Link>
		</div>
	);
}

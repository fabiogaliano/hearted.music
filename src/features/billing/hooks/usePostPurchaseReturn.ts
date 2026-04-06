/**
 * Detects return from Stripe checkout and polls billing state until the
 * purchase is reflected, then invalidates relevant query caches.
 *
 * Uses the same sessionStorage checkout intent as onboarding. After a full
 * page reload (Stripe redirect), the intent persists and this hook picks it
 * up in the authenticated layout.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { dashboardKeys } from "@/features/dashboard/queries";
import { likedSongsKeys } from "@/features/liked-songs/queries";
import type { BillingState } from "@/lib/domains/billing/state";
import { getBillingState } from "@/lib/server/billing.functions";
import {
	clearCheckoutIntent,
	loadCheckoutIntent,
} from "@/features/onboarding/checkout-intent";
import { billingKeys } from "../query-keys";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000;

function isCheckoutFulfilled(offer: string, state: BillingState): boolean {
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

/**
 * Runs once on mount in the authenticated layout. If a checkout intent
 * exists in sessionStorage, polls billing state until the purchase is
 * confirmed, then invalidates caches so the UI reflects the new state.
 */
export function usePostPurchaseReturn(
	accountId: string,
	billingState: BillingState,
) {
	const queryClient = useQueryClient();
	const hasRunRef = useRef(false);

	useEffect(() => {
		if (hasRunRef.current) return;

		const intent = loadCheckoutIntent();
		if (!intent) return;

		hasRunRef.current = true;

		if (isCheckoutFulfilled(intent.offer, billingState)) {
			clearCheckoutIntent();
			queryClient.invalidateQueries({ queryKey: billingKeys.state });
			queryClient.invalidateQueries({ queryKey: likedSongsKeys.all });
			queryClient.invalidateQueries({
				queryKey: likedSongsKeys.stats(accountId),
			});
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
			return;
		}

		let cancelled = false;
		const startTime = Date.now();

		const invalidateAll = () => {
			clearCheckoutIntent();
			queryClient.invalidateQueries({ queryKey: billingKeys.state });
			queryClient.invalidateQueries({ queryKey: likedSongsKeys.all });
			queryClient.invalidateQueries({
				queryKey: likedSongsKeys.stats(accountId),
			});
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
		};

		const poll = async () => {
			if (cancelled) return;

			try {
				const billing = await getBillingState();
				if (cancelled) return;

				if (isCheckoutFulfilled(intent.offer, billing)) {
					queryClient.setQueryData(billingKeys.state, billing);
					invalidateAll();
					return;
				}
			} catch {
				// Continue polling on transient errors
			}

			if (cancelled) return;

			if (Date.now() - startTime >= POLL_TIMEOUT_MS) {
				invalidateAll();
				return;
			}

			timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);
		};

		let timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);

		return () => {
			cancelled = true;
			clearTimeout(timeoutId);
		};
	}, [queryClient, accountId, billingState]);
}

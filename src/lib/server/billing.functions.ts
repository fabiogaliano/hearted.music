/**
 * Billing server functions.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { env } from "@/env";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { signBridgeRequest } from "@/lib/domains/billing/hmac";
import {
	isPackOffer,
	SONG_PACK_250,
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
} from "@/lib/domains/billing/offers";
import { readBillingState } from "@/lib/domains/billing/queries";
import type { BillingState } from "@/lib/domains/billing/state";
import {
	parseStripeCheckoutUrl,
	parseStripePortalUrl,
} from "@/lib/domains/billing/stripe-redirects";
import { requestSongUnlock as orchestrateUnlock } from "@/lib/domains/billing/unlocks";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";

const NoInputSchema = z.undefined();

export const getBillingState = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<BillingState> => {
		const supabase = createAdminSupabaseClient();
		const result = await readBillingState(supabase, context.session.accountId);

		if (Result.isError(result)) {
			// Runs in the _authenticated layout beforeLoad — on every authed page
			// load — so a silent DbError here would blank the whole app invisibly.
			captureServerError(result.error, {
				area: "billing",
				operation: "get_billing_state",
				accountId: context.session.accountId,
			});
			throw new Error("Failed to load billing state", {
				cause: result.error,
			});
		}

		return result.value;
	});

export interface SubscriptionUpgradeQuote {
	convertedCredits: number;
	discountCents: number;
}

export const getSubscriptionUpgradeQuote = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(async ({ context }): Promise<SubscriptionUpgradeQuote> => {
		const supabase = createAdminSupabaseClient();
		const { data, error } = await supabase
			.rpc("quote_subscription_upgrade_conversion", {
				p_account_id: context.session.accountId,
			})
			.single();

		if (error) {
			throw new Error("Failed to load subscription upgrade quote");
		}

		return {
			convertedCredits: data.converted_credits,
			discountCents: data.discount_cents,
		};
	});

const RequestSongUnlockSchema = z.object({
	songIds: z.array(z.string().uuid()).min(1).max(500),
});

export type RequestSongUnlockResponse =
	| {
			success: true;
			newlyUnlockedIds: string[];
			alreadyUnlockedIds: string[];
			remainingBalance: number;
	  }
	| {
			success: false;
			error: "insufficient_balance";
			required: number;
			available: number;
	  }
	| { success: false; error: "invalid_songs"; songIds: string[] }
	| { success: false; error: "unlimited_access_active" }
	| { success: false; error: "internal_error" };

export const requestSongUnlock = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => RequestSongUnlockSchema.parse(data))
	.handler(async ({ data, context }): Promise<RequestSongUnlockResponse> => {
		const supabase = createAdminSupabaseClient();
		const result = await orchestrateUnlock(
			supabase,
			context.session.accountId,
			data.songIds,
		);

		if (Result.isError(result)) {
			const err = result.error;
			switch (err.kind) {
				case "insufficient_balance":
					return {
						success: false,
						error: "insufficient_balance",
						required: err.required,
						available: err.available,
					};
				case "invalid_songs":
					return {
						success: false,
						error: "invalid_songs",
						songIds: err.songIds,
					};
				case "unlimited_access_active":
					return { success: false, error: "unlimited_access_active" };
				case "db_error":
					return { success: false, error: "internal_error" };
			}
		}

		return {
			success: true,
			newlyUnlockedIds: result.value.newlyUnlockedIds,
			alreadyUnlockedIds: result.value.alreadyUnlockedIds,
			remainingBalance: result.value.remainingBalance,
		};
	});

// ---------------------------------------------------------------------------
// Checkout & Portal session server functions
// ---------------------------------------------------------------------------

const VALID_OFFER_IDS = [
	SONG_PACK_250,
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
] as const;

type OfferId = (typeof VALID_OFFER_IDS)[number];

const OfferIdSchema = z.enum([
	SONG_PACK_250,
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
]);

const CreateCheckoutSessionSchema = z.object({
	offer: OfferIdSchema,
	checkoutAttemptId: z.string().uuid(),
});

function checkoutEndpointForOffer(offer: OfferId): string {
	if (isPackOffer(offer)) {
		return "/api/checkout/pack";
	}
	return "/api/checkout/unlimited";
}

export type CreateCheckoutSessionResponse =
	| { success: true; checkoutUrl: string }
	| { success: false; error: "billing_disabled" }
	| { success: false; error: "billing_unavailable" }
	| { success: false; error: "invalid_billing_redirect" }
	| { success: false; error: "rate_limited" };

export type CreatePortalSessionResponse =
	| { success: true; portalUrl: string }
	| { success: false; error: "billing_disabled" }
	| { success: false; error: "billing_unavailable" }
	| { success: false; error: "invalid_billing_redirect" }
	| { success: false; error: "rate_limited" };

/**
 * Reads and validates billing config. Detailed reasons are only logged
 * server-side — callers receive a single opaque "unavailable" signal so no
 * env or config detail leaks to the browser.
 */
function resolveBillingConfig():
	| { ok: true; serviceUrl: string; sharedSecret: string }
	| { ok: false; error: "billing_disabled" }
	| { ok: false; error: "billing_unavailable" } {
	if (!env.BILLING_ENABLED) {
		return { ok: false, error: "billing_disabled" };
	}

	if (!env.BILLING_SERVICE_URL || !env.BILLING_SHARED_SECRET) {
		console.error(
			"[billing] BILLING_ENABLED=true but BILLING_SERVICE_URL/BILLING_SHARED_SECRET are unset",
		);
		return { ok: false, error: "billing_unavailable" };
	}

	return {
		ok: true,
		serviceUrl: env.BILLING_SERVICE_URL,
		sharedSecret: env.BILLING_SHARED_SECRET,
	};
}

async function signedPost(
	url: string,
	body: string,
	secret: string,
): Promise<Response> {
	const { timestamp, signature } = await signBridgeRequest(body, secret);
	return fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Timestamp": timestamp,
			"X-Signature": signature,
		},
		body,
	});
}

export const createCheckoutSession = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => CreateCheckoutSessionSchema.parse(data))
	.handler(
		async ({ data, context }): Promise<CreateCheckoutSessionResponse> => {
			const config = resolveBillingConfig();
			if (!config.ok) return { success: false, error: config.error };

			const endpoint = checkoutEndpointForOffer(data.offer);
			const requestBody = JSON.stringify({
				account_id: context.session.accountId,
				offer_id: data.offer,
				checkout_attempt_id: data.checkoutAttemptId,
			});

			let response: Response;
			try {
				response = await signedPost(
					`${config.serviceUrl}${endpoint}`,
					requestBody,
					config.sharedSecret,
				);
			} catch (err) {
				// console.* does not reach Sentry (enableLogs:false) — a billing
				// service outage would otherwise be silent. Capture it.
				captureServerError(err, {
					area: "billing",
					operation: "create_checkout_session",
					accountId: context.session.accountId,
					extra: { stage: "reach_service", offer: data.offer },
				});
				return { success: false, error: "billing_unavailable" };
			}

			if (response.status === 429) {
				return { success: false, error: "rate_limited" };
			}

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				captureServerError(
					new Error(`billing checkout service returned ${response.status}`),
					{
						area: "billing",
						operation: "create_checkout_session",
						accountId: context.session.accountId,
						extra: {
							stage: "response_not_ok",
							status: response.status,
							body: text,
						},
					},
				);
				return { success: false, error: "billing_unavailable" };
			}

			let json: { checkout_url?: unknown };
			try {
				json = (await response.json()) as { checkout_url?: unknown };
			} catch (err) {
				captureServerError(err, {
					area: "billing",
					operation: "create_checkout_session",
					accountId: context.session.accountId,
					extra: { stage: "parse_response" },
				});
				return { success: false, error: "billing_unavailable" };
			}

			if (typeof json.checkout_url !== "string") {
				console.error(
					"[billing] checkout: billing service returned no checkout_url",
				);
				return { success: false, error: "billing_unavailable" };
			}

			const checkoutUrl = parseStripeCheckoutUrl(json.checkout_url);
			if (!checkoutUrl) {
				console.error(
					`[billing] checkout: rejected non-Stripe checkout URL: ${json.checkout_url}`,
				);
				return { success: false, error: "invalid_billing_redirect" };
			}

			return { success: true, checkoutUrl };
		},
	);

export const createPortalSession = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<CreatePortalSessionResponse> => {
		const config = resolveBillingConfig();
		if (!config.ok) return { success: false, error: config.error };

		const requestBody = JSON.stringify({
			account_id: context.session.accountId,
		});

		let response: Response;
		try {
			response = await signedPost(
				`${config.serviceUrl}/api/portal/session`,
				requestBody,
				config.sharedSecret,
			);
		} catch (err) {
			captureServerError(err, {
				area: "billing",
				operation: "create_portal_session",
				accountId: context.session.accountId,
				extra: { stage: "reach_service" },
			});
			return { success: false, error: "billing_unavailable" };
		}

		if (response.status === 429) {
			return { success: false, error: "rate_limited" };
		}

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			captureServerError(
				new Error(`billing portal service returned ${response.status}`),
				{
					area: "billing",
					operation: "create_portal_session",
					accountId: context.session.accountId,
					extra: {
						stage: "response_not_ok",
						status: response.status,
						body: text,
					},
				},
			);
			return { success: false, error: "billing_unavailable" };
		}

		let json: { portal_url?: unknown };
		try {
			json = (await response.json()) as { portal_url?: unknown };
		} catch (err) {
			captureServerError(err, {
				area: "billing",
				operation: "create_portal_session",
				accountId: context.session.accountId,
				extra: { stage: "parse_response" },
			});
			return { success: false, error: "billing_unavailable" };
		}

		if (typeof json.portal_url !== "string") {
			console.error("[billing] portal: billing service returned no portal_url");
			return { success: false, error: "billing_unavailable" };
		}

		const portalUrl = parseStripePortalUrl(json.portal_url);
		if (!portalUrl) {
			console.error(
				`[billing] portal: rejected non-Stripe portal URL: ${json.portal_url}`,
			);
			return { success: false, error: "invalid_billing_redirect" };
		}

		return { success: true, portalUrl };
	});

// ---------------------------------------------------------------------------
// Plan selection config (client-safe env flags)
// ---------------------------------------------------------------------------

export interface PlanSelectionConfig {
	billingEnabled: boolean;
	quarterlyPlanEnabled: boolean;
}

export const getPlanSelectionConfig = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async (): Promise<PlanSelectionConfig> => {
		return {
			billingEnabled: env.BILLING_ENABLED,
			quarterlyPlanEnabled: env.QUARTERLY_PLAN_ENABLED,
		};
	});

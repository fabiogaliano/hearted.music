/**
 * Billing server functions.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import type { BillingState } from "@/lib/domains/billing/state";
import { requestSongUnlock as orchestrateUnlock } from "@/lib/domains/billing/unlocks";
import { signBridgeRequest } from "@/lib/domains/billing/hmac";
import {
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
} from "@/lib/domains/billing/offers";
import { env } from "@/env";

export const getBillingState = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<BillingState> => {
		const supabase = createAdminSupabaseClient();
		const result = await readBillingState(supabase, context.session.accountId);

		if (Result.isError(result)) {
			throw new Error("Failed to load billing state");
		}

		return result.value;
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
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
] as const;

type OfferId = (typeof VALID_OFFER_IDS)[number];

const OfferIdSchema = z.enum([
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
]);

const CreateCheckoutSessionSchema = z.object({
	offer: OfferIdSchema,
	checkoutAttemptId: z.string().uuid(),
});

function checkoutEndpointForOffer(offer: OfferId): string {
	switch (offer) {
		case SONG_PACK_500:
			return "/api/checkout/pack";
		case UNLIMITED_QUARTERLY:
		case UNLIMITED_YEARLY:
			return "/api/checkout/unlimited";
	}
}

export type CreateCheckoutSessionResponse =
	| { success: true; checkoutUrl: string }
	| { success: false; error: "billing_disabled" }
	| { success: false; error: "invalid_offer" }
	| { success: false; error: "billing_service_error"; message: string };

export type CreatePortalSessionResponse =
	| { success: true; portalUrl: string }
	| { success: false; error: "billing_disabled" }
	| { success: false; error: "billing_service_error"; message: string };

/**
 * Reads and validates billing config. Returns typed error when billing is
 * disabled or env vars are misconfigured.
 */
function resolveBillingConfig():
	| { ok: true; serviceUrl: string; sharedSecret: string }
	| { ok: false; error: "billing_disabled" }
	| { ok: false; error: "billing_service_error"; message: string } {
	if (!env.BILLING_ENABLED) {
		return { ok: false, error: "billing_disabled" };
	}

	if (!env.BILLING_SERVICE_URL || !env.BILLING_SHARED_SECRET) {
		return {
			ok: false,
			error: "billing_service_error",
			message:
				"BILLING_SERVICE_URL and BILLING_SHARED_SECRET must be set when BILLING_ENABLED=true",
		};
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
			if (!config.ok) {
				return config.error === "billing_disabled"
					? { success: false, error: "billing_disabled" }
					: {
							success: false,
							error: "billing_service_error",
							message: config.message,
						};
			}

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
				return {
					success: false,
					error: "billing_service_error",
					message:
						err instanceof Error
							? err.message
							: "Failed to reach billing service",
				};
			}

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				return {
					success: false,
					error: "billing_service_error",
					message: `Billing service returned ${String(response.status)}: ${text}`,
				};
			}

			const json = (await response.json()) as { checkout_url?: string };
			if (!json.checkout_url) {
				return {
					success: false,
					error: "billing_service_error",
					message: "Billing service returned no checkout_url",
				};
			}

			return { success: true, checkoutUrl: json.checkout_url };
		},
	);

export const createPortalSession = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<CreatePortalSessionResponse> => {
		const config = resolveBillingConfig();
		if (!config.ok) {
			return config.error === "billing_disabled"
				? { success: false, error: "billing_disabled" }
				: {
						success: false,
						error: "billing_service_error",
						message: config.message,
					};
		}

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
			return {
				success: false,
				error: "billing_service_error",
				message:
					err instanceof Error
						? err.message
						: "Failed to reach billing service",
			};
		}

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			return {
				success: false,
				error: "billing_service_error",
				message: `Billing service returned ${String(response.status)}: ${text}`,
			};
		}

		const json = (await response.json()) as { portal_url?: string };
		if (!json.portal_url) {
			return {
				success: false,
				error: "billing_service_error",
				message: "Billing service returned no portal_url",
			};
		}

		return { success: true, portalUrl: json.portal_url };
	});

// ---------------------------------------------------------------------------
// Plan selection config (client-safe env flags)
// ---------------------------------------------------------------------------

export interface PlanSelectionConfig {
	quarterlyPlanEnabled: boolean;
}

export const getPlanSelectionConfig = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async (): Promise<PlanSelectionConfig> => {
		return {
			quarterlyPlanEnabled: env.QUARTERLY_PLAN_ENABLED,
		};
	});

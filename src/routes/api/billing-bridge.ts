/**
 * Billing Bridge Ingress Endpoint
 *
 * POST /api/billing-bridge — Receives billing-service → app bridge calls.
 *
 * Auth: HMAC signature verification using BILLING_SHARED_SECRET.
 *
 * Idempotency: status-based claim on billing_bridge_event. We record
 * processing *outcome*, not mere arrival, so a dispatch failure followed
 * by an upstream retry re-drives the handler instead of being silently
 * short-circuited as a duplicate. A lease window protects against rows
 * stuck in 'processing' after a server crash mid-dispatch.
 *
 * Upstream contract: billing-service MUST treat 409 as transient-retryable.
 * Full contract: docs/monetization/bridge-retry-contract.md
 *
 * Guard: Only available when BILLING_ENABLED=true.
 */

import { createFileRoute } from "@tanstack/react-router";
import { Result } from "better-result";
import { env } from "@/env";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	handlePackFulfilled,
	handlePackReversed,
	handleSubscriptionDeactivated,
	handleUnlimitedActivated,
	handleUnlimitedPeriodReversed,
} from "@/lib/domains/billing/bridge-handlers";
import {
	type BridgePayload,
	parseBridgePayload,
} from "@/lib/domains/billing/bridge-payloads";
import { verifyBridgeHmac } from "@/lib/domains/billing/hmac";
import {
	clientIpFrom,
	withinRateLimit,
} from "@/lib/platform/rate-limit/edge-rate-limit";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { captureWithWaitUntil } from "@/utils/posthog-server";

// Long enough to outlast any realistic handler run, short enough that a
// crashed worker's stuck row becomes reclaimable within the same Stripe
// retry cadence.
const BRIDGE_PROCESSING_LEASE_MS = 5 * 60 * 1000;

type ClaimOutcome = "claimed" | "duplicate_processed" | "in_progress";

function isClaimOutcome(value: unknown): value is ClaimOutcome {
	return (
		value === "claimed" ||
		value === "duplicate_processed" ||
		value === "in_progress"
	);
}

export const Route = createFileRoute("/api/billing-bridge")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				if (!env.BILLING_ENABLED) {
					return new Response("Not Found", { status: 404 });
				}

				// Throttle before HMAC verification so a flood can't burn worker
				// CPU on signature checks. Keyed by caller IP. Returns 503, not a
				// bare 429: the retry contract has the billing-service retry any 5xx,
				// so a legit burst that trips the limit is retried with backoff
				// instead of dropped (a 429 is a non-retryable 4xx under the contract).
				if (
					!(await withinRateLimit("BILLING_LIMITER", clientIpFrom(request)))
				) {
					return Response.json(
						{ error: "rate_limited" },
						{ status: 503, headers: { "retry-after": "60" } },
					);
				}

				const secret = env.BILLING_SHARED_SECRET;
				if (!secret) {
					console.error(
						"[billing-bridge] BILLING_SHARED_SECRET not configured",
					);
					return Response.json(
						{ error: "Server configuration error" },
						{ status: 500 },
					);
				}

				const hmacResult = await verifyBridgeHmac(request, secret);
				if (!hmacResult.valid) {
					return Response.json({ error: hmacResult.error }, { status: 401 });
				}

				let payload: BridgePayload;
				try {
					const raw = JSON.parse(hmacResult.body);
					const parsed = parseBridgePayload(raw);
					if (Result.isError(parsed)) {
						if (parsed.error.kind === "unsupported_schema_version") {
							console.error(
								`[billing-bridge] Unsupported schema_version=${String(parsed.error.schemaVersion)} for event_kind=${parsed.error.eventKind}`,
							);
							return Response.json(
								{ error: "Unsupported bridge schema version" },
								{ status: 500 },
							);
						}

						return Response.json(
							{ error: "Invalid request payload" },
							{ status: 400 },
						);
					}
					payload = parsed.value;
				} catch {
					return Response.json(
						{ error: "Invalid request payload" },
						{ status: 400 },
					);
				}

				const supabase = createAdminSupabaseClient();
				const claim = await supabase.rpc("claim_billing_bridge_event", {
					p_stripe_event_id: payload.stripe_event_id,
					p_event_kind: payload.event_kind,
					p_lease_ms: BRIDGE_PROCESSING_LEASE_MS,
				});

				if (claim.error || !isClaimOutcome(claim.data)) {
					console.error(
						"[billing-bridge] Failed to claim bridge event:",
						claim.error ?? { unexpected: claim.data },
					);
					return Response.json(
						{ error: "Internal server error" },
						{ status: 500 },
					);
				}

				if (claim.data === "duplicate_processed") {
					return Response.json({ ok: true, duplicate: true });
				}

				if (claim.data === "in_progress") {
					// Another worker holds a valid processing lease. Tell the
					// upstream to retry after its usual backoff.
					return Response.json({ error: "in_progress" }, { status: 409 });
				}

				console.log(
					`[billing-bridge] Claimed event_kind=${payload.event_kind} stripe_event=${payload.stripe_event_id}`,
				);

				try {
					await dispatchBridgeEvent(payload);
				} catch (err) {
					// Release the lease so the next upstream retry can reclaim
					// this event instead of being short-circuited as a duplicate.
					const message = errorMessage(err);
					const failMark = await supabase.rpc(
						"mark_billing_bridge_event_failed",
						{
							p_stripe_event_id: payload.stripe_event_id,
							p_error_message: message,
						},
					);
					if (failMark.error) {
						console.error(
							"[billing-bridge] Failed to record dispatch failure:",
							failMark.error,
						);
					}
					console.error("[billing-bridge] Handler dispatch failed:", err);
					return Response.json(
						{ error: "Internal processing error" },
						{ status: 500 },
					);
				}

				const processMark = await supabase.rpc(
					"mark_billing_bridge_event_processed",
					{ p_stripe_event_id: payload.stripe_event_id },
				);
				if (processMark.error) {
					// The handler succeeded but we couldn't record it. A retry
					// will reclaim this row via the lease timeout and re-run the
					// handler — handler-level idempotency must cover that case.
					console.error(
						"[billing-bridge] Failed to mark event processed:",
						processMark.error,
					);
					return Response.json(
						{ error: "Internal server error" },
						{ status: 500 },
					);
				}

				console.log(
					`[billing-bridge] Dispatched event_kind=${payload.event_kind}`,
				);

				// Fire-and-forget on the response itself; waitUntil keeps the
				// network round-trip alive past the Response return on CF Workers.
				await captureWithWaitUntil({
					distinctId: payload.account_id,
					event: "payment_processed",
					properties: {
						event_kind: payload.event_kind,
						stripe_event_id: payload.stripe_event_id,
					},
				});

				return Response.json({ ok: true });
			},
		},
	},
});

async function dispatchBridgeEvent(payload: BridgePayload): Promise<void> {
	const supabase = createAdminSupabaseClient();

	switch (payload.event_kind) {
		case "pack_fulfilled": {
			await handlePackFulfilled(supabase, {
				accountId: payload.account_id,
				bonusUnlockedSongIds: payload.bonus_unlocked_song_ids,
			});
			break;
		}
		case "unlimited_activated": {
			await handleUnlimitedActivated(supabase, {
				accountId: payload.account_id,
				stripeSubscriptionId: payload.stripe_subscription_id,
				subscriptionPeriodEnd: payload.subscription_period_end,
				stripeEventId: payload.stripe_event_id,
			});
			break;
		}
		case "pack_reversed": {
			await handlePackReversed({
				accountId: payload.account_id,
				accessRemoved: payload.access_removed,
			});
			break;
		}
		case "unlimited_period_reversed": {
			await handleUnlimitedPeriodReversed({
				accountId: payload.account_id,
				accessRemoved: payload.access_removed,
			});
			break;
		}
		case "subscription_deactivated": {
			await handleSubscriptionDeactivated(payload.account_id);
			break;
		}
	}
}

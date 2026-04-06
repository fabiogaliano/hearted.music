/**
 * Billing Bridge Ingress Endpoint
 *
 * POST /api/billing-bridge — Receives billing-service → app bridge calls.
 *
 * Auth: HMAC signature verification using BILLING_SHARED_SECRET.
 * Idempotency: billing_bridge_event PK constraint on stripe_event_id.
 * Guard: Only available when BILLING_ENABLED=true.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { env } from "@/env";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { verifyBridgeHmac } from "@/lib/domains/billing/hmac";
import { BillingChanges } from "@/lib/workflows/library-processing/changes/billing";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";

const BridgePayloadSchema = z.discriminatedUnion("event_kind", [
	z.object({
		stripe_event_id: z.string().min(1),
		event_kind: z.literal("pack_fulfilled"),
		account_id: z.string().uuid(),
		bonus_unlocked_song_ids: z.array(z.string().uuid()),
	}),
	z.object({
		stripe_event_id: z.string().min(1),
		event_kind: z.literal("unlimited_activated"),
		account_id: z.string().uuid(),
	}),
	z.object({
		stripe_event_id: z.string().min(1),
		event_kind: z.literal("pack_reversed"),
		account_id: z.string().uuid(),
	}),
	z.object({
		stripe_event_id: z.string().min(1),
		event_kind: z.literal("unlimited_period_reversed"),
		account_id: z.string().uuid(),
	}),
	z.object({
		stripe_event_id: z.string().min(1),
		event_kind: z.literal("subscription_deactivated"),
		account_id: z.string().uuid(),
	}),
]);

type BridgePayload = z.infer<typeof BridgePayloadSchema>;

export const Route = createFileRoute("/api/billing-bridge")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				if (!env.BILLING_ENABLED) {
					return new Response("Not Found", { status: 404 });
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
					payload = BridgePayloadSchema.parse(raw);
				} catch {
					return Response.json(
						{ error: "Invalid request payload" },
						{ status: 400 },
					);
				}

				const supabase = createAdminSupabaseClient();
				const { data, error } = await supabase
					.from("billing_bridge_event")
					.insert({
						stripe_event_id: payload.stripe_event_id,
						event_kind: payload.event_kind,
					})
					.select("stripe_event_id")
					.single();

				if (error && error.code !== "23505") {
					console.error(
						"[billing-bridge] Failed to insert bridge event:",
						error,
					);
					return Response.json(
						{ error: "Internal server error" },
						{ status: 500 },
					);
				}

				// Duplicate delivery — no-op, return success
				if (!data) {
					return Response.json({ ok: true, duplicate: true });
				}

				try {
					await dispatchBridgeEvent(payload);
				} catch (err) {
					console.error("[billing-bridge] Handler dispatch failed:", err);
					return Response.json(
						{ error: "Internal processing error" },
						{ status: 500 },
					);
				}

				return Response.json({ ok: true });
			},
		},
	},
});

async function dispatchBridgeEvent(payload: BridgePayload): Promise<void> {
	switch (payload.event_kind) {
		case "pack_fulfilled": {
			const change = BillingChanges.songsUnlocked(
				payload.account_id,
				payload.bonus_unlocked_song_ids,
			);
			await applyLibraryProcessingChange(change);
			break;
		}
		case "unlimited_activated": {
			const change = BillingChanges.unlimitedActivated(payload.account_id);
			await applyLibraryProcessingChange(change);
			break;
		}
		case "pack_reversed":
		case "unlimited_period_reversed":
		case "subscription_deactivated": {
			const change = BillingChanges.candidateAccessRevoked(payload.account_id);
			await applyLibraryProcessingChange(change);
			break;
		}
	}
}

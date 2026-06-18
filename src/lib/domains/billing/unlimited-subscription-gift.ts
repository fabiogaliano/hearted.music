/**
 * Operator gift of an unlimited subscription ("Backstage Pass" when yearly).
 *
 * Mirrors the exact DB effects a real Stripe activation produces, so a gifted
 * account is indistinguishable from a paid one downstream:
 *   1. activate_subscription   → plan + unlimited_access_source='subscription'
 *                                + subscription_status='active' + period_end
 *   2. activate_unlimited_songs → materialize 'unlimited' unlock rows for the
 *                                account's analyzed liked songs
 *   3. handleUnlimitedActivated → activation marker + enrichment/match refresh
 *                                (the same library-processing side effect the
 *                                Stripe bridge fires)
 *
 * Because there is no real Stripe subscription, no webhook will ever flip the
 * gift off: it does NOT auto-expire at period_end. period_end is still set one
 * duration out so the UI/audit show the right date and the enrichment
 * content-activation stage has valid provenance; expiry is a manual revoke (or
 * a future scheduled deactivation past period_end).
 *
 * Idempotent: re-running while access is already active is a no-op
 * (already_unlimited), and it never clobbers a real paid subscriber or a
 * self-hosted unlimited account.
 */

import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { handleUnlimitedActivated } from "@/lib/domains/billing/bridge-handlers";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";

/** Plans that grant unlimited access. `yearly` surfaces as "Backstage Pass". */
export type GiftUnlimitedPlan = "yearly" | "quarterly";

export type GiftUnlimitedSubscriptionResult =
	| {
			status: "gifted";
			plan: GiftUnlimitedPlan;
			subscriptionPeriodEnd: string;
			unlockedSongCount: number;
	  }
	| { status: "already_unlimited"; source: "subscription" | "self_hosted" };

interface GiftUnlimitedSubscriptionArgs {
	accountId: string;
	/** Defaults to `yearly` (Backstage Pass). */
	plan?: GiftUnlimitedPlan;
	/** Length of the gifted period in days. Defaults to 365. */
	durationDays?: number;
	/** Injected clock for deterministic tests; defaults to the real now. */
	at?: Date;
}

const DEFAULT_PLAN: GiftUnlimitedPlan = "yearly";
const DEFAULT_DURATION_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dbErr(error: {
	code: string;
	message: string;
}): Result<never, DbError> {
	return Result.err(
		new DatabaseError({ code: error.code, message: error.message }),
	);
}

export async function giftUnlimitedSubscriptionForAccount(
	supabase: AdminSupabaseClient,
	args: GiftUnlimitedSubscriptionArgs,
): Promise<Result<GiftUnlimitedSubscriptionResult, DbError>> {
	const plan = args.plan ?? DEFAULT_PLAN;
	const durationDays = args.durationDays ?? DEFAULT_DURATION_DAYS;
	const now = args.at ?? new Date();

	// Read first so we never overwrite a real subscriber's Stripe linkage and can
	// short-circuit when access is already active.
	const { data: existing, error: readError } = await supabase
		.from("account_billing")
		.select("stripe_customer_id, unlimited_access_source, subscription_status")
		.eq("account_id", args.accountId)
		.maybeSingle();

	if (readError) return dbErr(readError);
	if (existing === null) {
		return dbErr({
			code: "NO_BILLING_ROW",
			message: `account ${args.accountId} has no account_billing row`,
		});
	}

	if (existing.unlimited_access_source === "self_hosted") {
		return Result.ok({ status: "already_unlimited", source: "self_hosted" });
	}
	if (
		existing.unlimited_access_source === "subscription" &&
		existing.subscription_status === "active"
	) {
		return Result.ok({ status: "already_unlimited", source: "subscription" });
	}

	const subscriptionPeriodEnd = new Date(
		now.getTime() + durationDays * MS_PER_DAY,
	).toISOString();
	const eventCreatedAt = now.toISOString();
	// Synthetic, stable-per-account markers: stable so the UNIQUE constraints on
	// stripe_subscription_id and billing_activation make re-runs idempotent; the
	// `gift_` prefix flags the row as operator-originated, not a real Stripe sub.
	const stripeSubscriptionId = `gift_sub_${args.accountId}`;
	// Preserve any existing real Stripe customer so portal/checkout linkage isn't
	// broken; only synthesize one for accounts that never touched Stripe.
	const stripeCustomerId =
		existing.stripe_customer_id ?? `gift_cus_${args.accountId}`;
	const stripeEventId = `gift_evt_${args.accountId}_${subscriptionPeriodEnd}`;

	const { error: activateError } = await supabase.rpc("activate_subscription", {
		p_account_id: args.accountId,
		p_plan: plan,
		p_stripe_subscription_id: stripeSubscriptionId,
		p_stripe_customer_id: stripeCustomerId,
		p_subscription_period_end: subscriptionPeriodEnd,
		p_stripe_event_created_at: eventCreatedAt,
	});
	if (activateError) return dbErr(activateError);

	const { data: unlocked, error: unlockError } = await supabase.rpc(
		"activate_unlimited_songs",
		{
			p_account_id: args.accountId,
			p_granted_stripe_subscription_id: stripeSubscriptionId,
			p_granted_subscription_period_end: subscriptionPeriodEnd,
		},
	);
	if (unlockError) return dbErr(unlockError);

	// Same downstream side effects as a real Stripe activation. Best-effort: the
	// durable entitlement (billing row + unlock rows) is already committed, so a
	// side-effect failure is logged, not surfaced — matching the repo's pattern
	// for non-transactional workflow effects.
	try {
		await handleUnlimitedActivated(supabase, {
			accountId: args.accountId,
			stripeSubscriptionId,
			subscriptionPeriodEnd,
			stripeEventId,
		});
	} catch (err) {
		console.error(
			"[unlimited-subscription-gift] activation side effect failed:",
			err instanceof Error ? err.message : err,
		);
	}

	return Result.ok({
		status: "gifted",
		plan,
		subscriptionPeriodEnd,
		unlockedSongCount: Array.isArray(unlocked) ? unlocked.length : 0,
	});
}

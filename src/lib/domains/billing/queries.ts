/**
 * Billing state queries.
 *
 * Reads and normalizes the account_billing row into the canonical BillingState
 * type. Includes self-healing for missing rows (invariant violation).
 */

import { Result } from "better-result";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { fromSupabaseMaybe } from "@/lib/shared/utils/result-wrappers/supabase";
import type { AdminSupabaseClient } from "@/lib/data/client";
import type {
	BillingPlan,
	BillingState,
	NormalizedSubscriptionStatus,
	UnlimitedAccess,
} from "@/lib/domains/billing/state";
import { STRIPE_STATUS_TO_NORMALIZED } from "@/lib/domains/billing/state";

const FREE_DEFAULT: BillingState = {
	plan: "free",
	creditBalance: 0,
	subscriptionStatus: "none",
	cancelAtPeriodEnd: false,
	unlimitedAccess: { kind: "none" },
	queueBand: "low",
};

const VALID_PLANS = new Set<string>(["free", "quarterly", "yearly"]);

function parsePlan(raw: string): BillingPlan {
	if (VALID_PLANS.has(raw)) return raw as BillingPlan;
	return "free";
}

function parseUnlimitedAccess(source: string | null): UnlimitedAccess {
	switch (source) {
		case null:
			return { kind: "none" };
		case "subscription":
			return { kind: "subscription" };
		case "self_hosted":
			return { kind: "self_hosted" };
		default:
			return { kind: "none" };
	}
}

type QueueBand = "low" | "standard" | "priority";

function resolveQueueBand(
	plan: BillingPlan,
	unlimitedAccess: UnlimitedAccess,
	subscriptionStatus: NormalizedSubscriptionStatus,
	creditBalance: number,
): QueueBand {
	if (unlimitedAccess.kind === "self_hosted") return "priority";

	if (
		plan === "yearly" &&
		unlimitedAccess.kind === "subscription" &&
		subscriptionStatus === "active"
	)
		return "priority";

	if (
		plan === "quarterly" &&
		unlimitedAccess.kind === "subscription" &&
		subscriptionStatus === "active"
	)
		return "standard";

	if (unlimitedAccess.kind === "none" && creditBalance > 0) return "standard";

	return "low";
}

/**
 * Reads and normalizes billing state for an account.
 *
 * Self-healing: if no account_billing row exists (invariant violation),
 * inserts a default free row via INSERT ... ON CONFLICT DO NOTHING, then
 * returns the free default. The insert is best-effort; if it races with
 * a concurrent insert the CONFLICT means we just return the default.
 */
export async function readBillingState(
	supabase: AdminSupabaseClient,
	accountId: string,
): Promise<Result<BillingState, DbError>> {
	const result = await fromSupabaseMaybe(
		supabase
			.from("account_billing")
			.select("*")
			.eq("account_id", accountId)
			.single(),
	);

	if (Result.isError(result)) return result;

	const row = result.value;

	if (row === null) {
		const { error: insertError } = await supabase
			.from("account_billing")
			.insert({ account_id: accountId })
			.select()
			.single();

		if (insertError && insertError.code !== "23505") {
			return Result.err(
				new DatabaseError({
					code: insertError.code,
					message: `Self-healing insert failed for account ${accountId}: ${insertError.message}`,
				}),
			);
		}

		return Result.ok(FREE_DEFAULT);
	}

	const plan = parsePlan(row.plan);
	const unlimitedAccess = parseUnlimitedAccess(row.unlimited_access_source);
	const creditBalance = row.credit_balance;
	const cancelAtPeriodEnd = row.cancel_at_period_end;

	let subscriptionStatus: NormalizedSubscriptionStatus =
		STRIPE_STATUS_TO_NORMALIZED[row.subscription_status] ?? "none";

	if (subscriptionStatus === "active" && cancelAtPeriodEnd) {
		subscriptionStatus = "ending";
	}

	const queueBand = resolveQueueBand(
		plan,
		unlimitedAccess,
		subscriptionStatus,
		creditBalance,
	);

	return Result.ok({
		plan,
		creditBalance,
		subscriptionStatus,
		cancelAtPeriodEnd,
		unlimitedAccess,
		queueBand,
	});
}

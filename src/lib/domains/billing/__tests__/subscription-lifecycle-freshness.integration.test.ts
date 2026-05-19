import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/data/database.types";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const IS_LOCAL =
	SUPABASE_URL.startsWith("http://127.0.0.1") &&
	SUPABASE_SERVICE_ROLE_KEY.length > 0;

const supabase = IS_LOCAL
	? createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false },
		})
	: null;

function client() {
	if (!supabase) throw new Error("supabase client not initialised");
	return supabase;
}

let accountId = "";

async function seedAccount() {
	accountId = crypto.randomUUID();

	await client()
		.from("account")
		.insert({ id: accountId, spotify_id: `test-${accountId}` })
		.throwOnError();

	await client()
		.from("account_billing")
		.insert({
			account_id: accountId,
			plan: "free",
			subscription_status: "none",
			credit_balance: 0,
		})
		.throwOnError();
}

async function readBillingRow() {
	const { data, error } = await client()
		.from("account_billing")
		.select(
			"plan, subscription_status, subscription_period_end, cancel_at_period_end, unlimited_access_source, last_subscription_state_event_created_at",
		)
		.eq("account_id", accountId)
		.single();

	if (error) throw error;
	return data;
}

describe.skipIf(!IS_LOCAL)("subscription lifecycle freshness guards", () => {
	beforeEach(async () => {
		await seedAccount();
	});

	afterEach(async () => {
		if (!supabase || !accountId) return;
		await supabase.from("account").delete().eq("id", accountId);
		accountId = "";
	});

	it("ignores stale deactivate/update calls after a newer activation", async () => {
		const activatedAt = "2026-05-19T12:10:00.000Z";
		const staleDeactivateAt = "2026-05-19T12:00:00.000Z";
		const staleUpdateAt = "2026-05-19T12:05:00.000Z";
		const periodEnd = "2026-06-19T12:10:00.000Z";

		const activate = await client().rpc("activate_subscription", {
			p_account_id: accountId,
			p_plan: "yearly",
			p_stripe_subscription_id: "sub_test_freshness",
			p_stripe_customer_id: "cus_test_freshness",
			p_subscription_period_end: periodEnd,
			p_stripe_event_created_at: activatedAt,
		});
		expect(activate.error).toBeNull();

		const staleDeactivate = await client().rpc("deactivate_subscription", {
			p_account_id: accountId,
			p_stripe_event_created_at: staleDeactivateAt,
		});
		expect(staleDeactivate.error).toBeNull();

		const staleUpdate = await client().rpc("update_subscription_state", {
			p_account_id: accountId,
			p_subscription_status: "past_due",
			p_subscription_period_end: "2026-06-01T00:00:00.000Z",
			p_cancel_at_period_end: true,
			p_stripe_event_created_at: staleUpdateAt,
		});
		expect(staleUpdate.error).toBeNull();

		const row = await readBillingRow();
		expect(row).toMatchObject({
			plan: "yearly",
			subscription_status: "active",
			cancel_at_period_end: false,
			unlimited_access_source: "subscription",
		});
		expect(new Date(row.subscription_period_end ?? "").toISOString()).toBe(
			periodEnd,
		);
		expect(
			new Date(
				row.last_subscription_state_event_created_at ?? "",
			).toISOString(),
		).toBe(activatedAt);
	});

	it("applies newer cancellation state and blocks stale reactivation", async () => {
		const activatedAt = "2026-05-19T12:00:00.000Z";
		const canceledAt = "2026-05-19T12:20:00.000Z";
		const staleReactivationAt = "2026-05-19T12:05:00.000Z";
		const activePeriodEnd = "2026-06-19T12:00:00.000Z";
		const canceledPeriodEnd = "2026-05-19T12:20:00.000Z";

		const activate = await client().rpc("activate_subscription", {
			p_account_id: accountId,
			p_plan: "quarterly",
			p_stripe_subscription_id: "sub_test_cancel",
			p_stripe_customer_id: "cus_test_cancel",
			p_subscription_period_end: activePeriodEnd,
			p_stripe_event_created_at: activatedAt,
		});
		expect(activate.error).toBeNull();

		const updateState = await client().rpc("update_subscription_state", {
			p_account_id: accountId,
			p_subscription_status: "canceled",
			p_subscription_period_end: canceledPeriodEnd,
			p_cancel_at_period_end: false,
			p_stripe_event_created_at: canceledAt,
		});
		expect(updateState.error).toBeNull();

		const deactivate = await client().rpc("deactivate_subscription", {
			p_account_id: accountId,
			p_stripe_event_created_at: canceledAt,
		});
		expect(deactivate.error).toBeNull();

		const staleReactivation = await client().rpc("activate_subscription", {
			p_account_id: accountId,
			p_plan: "yearly",
			p_stripe_subscription_id: "sub_test_cancel",
			p_stripe_customer_id: "cus_test_cancel",
			p_subscription_period_end: "2026-07-19T12:05:00.000Z",
			p_stripe_event_created_at: staleReactivationAt,
		});
		expect(staleReactivation.error).toBeNull();

		const row = await readBillingRow();
		expect(row).toMatchObject({
			plan: "free",
			subscription_status: "canceled",
			cancel_at_period_end: false,
			unlimited_access_source: null,
		});
		expect(new Date(row.subscription_period_end ?? "").toISOString()).toBe(
			canceledPeriodEnd,
		);
		expect(
			new Date(
				row.last_subscription_state_event_created_at ?? "",
			).toISOString(),
		).toBe(canceledAt);
	});
});

import { describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "../queries";

/**
 * Builds a mock AdminSupabaseClient that returns the given row from
 * account_billing select, or simulates a missing row.
 */
function mockSupabase(row: Record<string, unknown> | null) {
	const singleFn = vi
		.fn()
		.mockResolvedValue(
			row === null
				? { data: null, error: { code: "PGRST116", message: "not found" } }
				: { data: row, error: null },
		);

	const eqFn = vi.fn().mockReturnValue({ single: singleFn });
	const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
	const fromFn = vi.fn().mockReturnValue({ select: selectFn });

	const insertSingleFn = vi.fn().mockResolvedValue({ data: null, error: null });
	const insertSelectFn = vi.fn().mockReturnValue({ single: insertSingleFn });
	const insertFn = vi.fn().mockReturnValue({ select: insertSelectFn });

	fromFn.mockImplementation((table: string) => {
		if (table === "account_billing") {
			return {
				select: selectFn,
				insert: insertFn,
			};
		}
		return { select: selectFn };
	});

	return {
		client: { from: fromFn } as unknown as AdminSupabaseClient,
		fromFn,
		insertFn,
	};
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		account_id: "acc-1",
		plan: "free",
		credit_balance: 0,
		subscription_status: "none",
		cancel_at_period_end: false,
		unlimited_access_source: null,
		stripe_customer_id: null,
		stripe_subscription_id: null,
		subscription_period_end: null,
		created_at: "2025-01-01T00:00:00Z",
		updated_at: "2025-01-01T00:00:00Z",
		...overrides,
	};
}

describe("readBillingState", () => {
	it("returns free default and self-heals when no row exists", async () => {
		const { client, insertFn } = mockSupabase(null);
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value).toEqual({
			plan: "free",
			creditBalance: 0,
			subscriptionStatus: "none",
			cancelAtPeriodEnd: false,
			unlimitedAccess: { kind: "none" },
			queueBand: "low",
		});

		expect(insertFn).toHaveBeenCalledWith({ account_id: "acc-1" });
	});

	it("self-healing does not return credit balance or unlimited access", async () => {
		const { client } = mockSupabase(null);
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.creditBalance).toBe(0);
		expect(result.value.unlimitedAccess).toEqual({ kind: "none" });
	});

	it("returns standard queueBand for account with positive credit balance", async () => {
		const { client } = mockSupabase(makeRow({ credit_balance: 5 }));
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.creditBalance).toBe(5);
		expect(result.value.queueBand).toBe("standard");
	});

	it("returns standard queueBand for quarterly subscription active", async () => {
		const { client } = mockSupabase(
			makeRow({
				plan: "quarterly",
				subscription_status: "active",
				unlimited_access_source: "subscription",
			}),
		);
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.plan).toBe("quarterly");
		expect(result.value.subscriptionStatus).toBe("active");
		expect(result.value.unlimitedAccess).toEqual({ kind: "subscription" });
		expect(result.value.queueBand).toBe("standard");
	});

	it("returns priority queueBand for yearly subscription active", async () => {
		const { client } = mockSupabase(
			makeRow({
				plan: "yearly",
				subscription_status: "active",
				unlimited_access_source: "subscription",
			}),
		);
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.plan).toBe("yearly");
		expect(result.value.subscriptionStatus).toBe("active");
		expect(result.value.queueBand).toBe("priority");
	});

	it("normalizes active + cancel_at_period_end to 'ending'", async () => {
		const { client } = mockSupabase(
			makeRow({
				plan: "quarterly",
				subscription_status: "active",
				cancel_at_period_end: true,
				unlimited_access_source: "subscription",
			}),
		);
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.subscriptionStatus).toBe("ending");
		expect(result.value.cancelAtPeriodEnd).toBe(true);
	});

	it("normalizes past_due Stripe status to past_due and queueBand low", async () => {
		const { client } = mockSupabase(
			makeRow({
				plan: "quarterly",
				subscription_status: "past_due",
				unlimited_access_source: "subscription",
			}),
		);
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.subscriptionStatus).toBe("past_due");
		expect(result.value.queueBand).toBe("low");
	});

	it("normalizes unpaid Stripe status to past_due", async () => {
		const { client } = mockSupabase(
			makeRow({
				plan: "quarterly",
				subscription_status: "unpaid",
				unlimited_access_source: "subscription",
			}),
		);
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.subscriptionStatus).toBe("past_due");
	});

	it("normalizes canceled Stripe status to none", async () => {
		const { client } = mockSupabase(
			makeRow({
				plan: "quarterly",
				subscription_status: "canceled",
				unlimited_access_source: "subscription",
			}),
		);
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.subscriptionStatus).toBe("none");
	});

	it("returns priority queueBand for self_hosted regardless of Stripe state", async () => {
		const { client } = mockSupabase(
			makeRow({
				plan: "free",
				subscription_status: "none",
				unlimited_access_source: "self_hosted",
			}),
		);
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.unlimitedAccess).toEqual({ kind: "self_hosted" });
		expect(result.value.queueBand).toBe("priority");
	});

	it("normalizes incomplete Stripe status to none", async () => {
		const { client } = mockSupabase(
			makeRow({ subscription_status: "incomplete" }),
		);
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.subscriptionStatus).toBe("none");
	});

	it("normalizes incomplete_expired Stripe status to none", async () => {
		const { client } = mockSupabase(
			makeRow({ subscription_status: "incomplete_expired" }),
		);
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.subscriptionStatus).toBe("none");
	});

	it("falls back to free plan for unknown plan values", async () => {
		const { client } = mockSupabase(makeRow({ plan: "unknown_plan" }));
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.plan).toBe("free");
	});

	it("falls back to none for unknown unlimited_access_source values", async () => {
		const { client } = mockSupabase(
			makeRow({ unlimited_access_source: "some_future_source" }),
		);
		const result = await readBillingState(client, "acc-1");

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.unlimitedAccess).toEqual({ kind: "none" });
	});
});

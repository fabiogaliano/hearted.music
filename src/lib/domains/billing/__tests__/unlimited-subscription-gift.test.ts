import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/domains/billing/bridge-handlers", () => ({
	handleUnlimitedActivated: vi.fn(),
}));

import type { AdminSupabaseClient } from "@/lib/data/client";
import { handleUnlimitedActivated } from "@/lib/domains/billing/bridge-handlers";
import { DatabaseError } from "@/lib/shared/errors/database";
import { giftUnlimitedSubscriptionForAccount } from "../unlimited-subscription-gift";

const mockedSideEffect = vi.mocked(handleUnlimitedActivated);

type BillingRow = {
	stripe_customer_id: string | null;
	unlimited_access_source: string | null;
	subscription_status: string | null;
} | null;

type RpcResult = { data: unknown; error: unknown };

function makeClient(opts: {
	billing?: BillingRow;
	billingError?: { code: string; message: string } | null;
	rpc?: (name: string) => RpcResult;
}) {
	const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
	const rpcFn = vi
		.fn()
		.mockImplementation((name: string, args: Record<string, unknown>) => {
			rpcCalls.push({ name, args });
			return Promise.resolve(
				opts.rpc ? opts.rpc(name) : { data: [], error: null },
			);
		});

	const maybeSingle = vi.fn().mockResolvedValue({
		data: opts.billing === undefined ? null : opts.billing,
		error: opts.billingError ?? null,
	});
	const eq = vi.fn().mockReturnValue({ maybeSingle });
	const select = vi.fn().mockReturnValue({ eq });
	const from = vi.fn().mockReturnValue({ select });

	const client = { rpc: rpcFn, from } as unknown as AdminSupabaseClient;
	return { client, rpcCalls };
}

const AT = new Date("2026-06-18T00:00:00.000Z");
const PERIOD_END = "2027-06-18T00:00:00.000Z";

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	mockedSideEffect.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
	mockedSideEffect.mockReset();
});

describe("giftUnlimitedSubscriptionForAccount", () => {
	it("activates a yearly subscription one year out and fires the side effect", async () => {
		const { client, rpcCalls } = makeClient({
			billing: {
				stripe_customer_id: null,
				unlimited_access_source: null,
				subscription_status: "none",
			},
			rpc: (name) =>
				name === "activate_unlimited_songs"
					? { data: [{ song_id: "s1" }, { song_id: "s2" }], error: null }
					: { data: null, error: null },
		});

		const result = await giftUnlimitedSubscriptionForAccount(client, {
			accountId: "acc-1",
			at: AT,
		});

		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value).toEqual({
			status: "gifted",
			plan: "yearly",
			subscriptionPeriodEnd: PERIOD_END,
			unlockedSongCount: 2,
		});

		const activate = rpcCalls.find((c) => c.name === "activate_subscription");
		expect(activate?.args).toMatchObject({
			p_account_id: "acc-1",
			p_plan: "yearly",
			p_stripe_subscription_id: "gift_sub_acc-1",
			p_stripe_customer_id: "gift_cus_acc-1",
			p_subscription_period_end: PERIOD_END,
		});

		expect(mockedSideEffect).toHaveBeenCalledWith(client, {
			accountId: "acc-1",
			stripeSubscriptionId: "gift_sub_acc-1",
			subscriptionPeriodEnd: PERIOD_END,
			stripeEventId: `gift_evt_acc-1_${PERIOD_END}`,
		});
	});

	it("preserves an existing real Stripe customer id", async () => {
		const { client, rpcCalls } = makeClient({
			billing: {
				stripe_customer_id: "cus_real123",
				unlimited_access_source: null,
				subscription_status: "none",
			},
		});

		await giftUnlimitedSubscriptionForAccount(client, {
			accountId: "acc-1",
			at: AT,
		});

		const activate = rpcCalls.find((c) => c.name === "activate_subscription");
		expect(activate?.args.p_stripe_customer_id).toBe("cus_real123");
	});

	it("is a no-op when the account already has an active subscription", async () => {
		const { client, rpcCalls } = makeClient({
			billing: {
				stripe_customer_id: "cus_real123",
				unlimited_access_source: "subscription",
				subscription_status: "active",
			},
		});

		const result = await giftUnlimitedSubscriptionForAccount(client, {
			accountId: "acc-1",
			at: AT,
		});

		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value).toEqual({
			status: "already_unlimited",
			source: "subscription",
		});
		expect(rpcCalls).toHaveLength(0);
		expect(mockedSideEffect).not.toHaveBeenCalled();
	});

	it("is a no-op for self-hosted unlimited accounts", async () => {
		const { client, rpcCalls } = makeClient({
			billing: {
				stripe_customer_id: null,
				unlimited_access_source: "self_hosted",
				subscription_status: "none",
			},
		});

		const result = await giftUnlimitedSubscriptionForAccount(client, {
			accountId: "acc-1",
			at: AT,
		});

		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value).toEqual({
			status: "already_unlimited",
			source: "self_hosted",
		});
		expect(rpcCalls).toHaveLength(0);
	});

	it("errors when the account has no billing row", async () => {
		const { client } = makeClient({ billing: null });

		const result = await giftUnlimitedSubscriptionForAccount(client, {
			accountId: "acc-1",
			at: AT,
		});

		expect(Result.isError(result)).toBe(true);
		if (Result.isOk(result)) throw new Error("expected error");
		expect(result.error).toBeInstanceOf(DatabaseError);
		expect((result.error as DatabaseError).code).toBe("NO_BILLING_ROW");
	});

	it("propagates an activate_subscription RPC error", async () => {
		const { client } = makeClient({
			billing: {
				stripe_customer_id: null,
				unlimited_access_source: null,
				subscription_status: "none",
			},
			rpc: (name) =>
				name === "activate_subscription"
					? { data: null, error: { code: "XX000", message: "boom" } }
					: { data: [], error: null },
		});

		const result = await giftUnlimitedSubscriptionForAccount(client, {
			accountId: "acc-1",
			at: AT,
		});

		expect(Result.isError(result)).toBe(true);
		if (Result.isOk(result)) throw new Error("expected error");
		expect(result.error).toBeInstanceOf(DatabaseError);
		expect((result.error as DatabaseError).message).toBe("boom");
	});

	it("still succeeds when the best-effort side effect throws", async () => {
		mockedSideEffect.mockRejectedValue(new Error("snapshot refresh failed"));
		const { client } = makeClient({
			billing: {
				stripe_customer_id: null,
				unlimited_access_source: null,
				subscription_status: "none",
			},
			rpc: (name) =>
				name === "activate_unlimited_songs"
					? { data: [{ song_id: "s1" }], error: null }
					: { data: null, error: null },
		});

		const result = await giftUnlimitedSubscriptionForAccount(client, {
			accountId: "acc-1",
			at: AT,
		});

		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value.status).toBe("gifted");
	});
});

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSupabaseClient } from "@/lib/data/client";

vi.mock("@/lib/domains/billing/queries", () => ({
	readBillingState: vi.fn(),
}));

import { makeBillingState } from "@/lib/domains/billing/fixtures";
import { readBillingState } from "@/lib/domains/billing/queries";
import { DatabaseError } from "@/lib/shared/errors/database";
import { unlockEntitledSongs } from "../song-entitlement";

const mockedReadBillingState = vi.mocked(readBillingState);

type Provenance = {
	stripe_subscription_id: string | null;
	subscription_period_end: string | null;
} | null;

function makeSupabase(options: {
	provenance?: Provenance;
	rpcError?: { code: string; message: string };
}) {
	const rpc = vi.fn().mockResolvedValue({
		data: null,
		error: options.rpcError ?? null,
	});
	const single = vi
		.fn()
		.mockResolvedValue({ data: options.provenance ?? null, error: null });
	const from = vi.fn().mockReturnValue({
		select: () => ({ eq: () => ({ single }) }),
	});
	return { client: { rpc, from } as unknown as AdminSupabaseClient, rpc };
}

function billingWith(kind: "none" | "subscription" | "self_hosted") {
	mockedReadBillingState.mockResolvedValue(
		Result.ok(makeBillingState({ unlimitedAccess: { kind } })),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("unlockEntitledSongs", () => {
	it("leaves songs locked without any billing write when the account has no unlimited access", async () => {
		billingWith("none");
		const { client, rpc } = makeSupabase({});

		const result = await unlockEntitledSongs(client, "account-1", ["song-1"]);

		expect(result).toHaveOkValue({ kind: "left_locked" });
		expect(rpc).not.toHaveBeenCalled();
	});

	describe("unlimited subscription", () => {
		it("activates with the subscription that granted access", async () => {
			billingWith("subscription");
			const { client, rpc } = makeSupabase({
				provenance: {
					stripe_subscription_id: "sub_123",
					subscription_period_end: "2026-07-01T00:00:00Z",
				},
			});

			const result = await unlockEntitledSongs(client, "account-1", ["song-1"]);

			expect(result).toHaveOkValue({ kind: "unlocked_unlimited" });
			expect(rpc).toHaveBeenCalledWith("activate_unlimited_songs", {
				p_account_id: "account-1",
				p_granted_stripe_subscription_id: "sub_123",
				p_granted_subscription_period_end: "2026-07-01T00:00:00Z",
			});
		});

		it("refuses to activate when subscription provenance is missing", async () => {
			billingWith("subscription");
			const { client, rpc } = makeSupabase({
				provenance: {
					stripe_subscription_id: null,
					subscription_period_end: null,
				},
			});

			const result = await unlockEntitledSongs(client, "account-1", ["song-1"]);

			expect(result).toBeErr();
			expect(Result.isError(result) && result.error.message).toMatch(
				/missing subscription provenance/i,
			);
			expect(rpc).not.toHaveBeenCalled();
		});

		it("returns an error when the activation RPC fails", async () => {
			billingWith("subscription");
			const { client } = makeSupabase({
				provenance: {
					stripe_subscription_id: "sub_123",
					subscription_period_end: "2026-07-01T00:00:00Z",
				},
				rpcError: { code: "57014", message: "rpc timeout" },
			});

			const result = await unlockEntitledSongs(client, "account-1", ["song-1"]);

			expect(result).toBeErr();
			expect(Result.isError(result) && result.error.message).toMatch(
				/activate_unlimited_songs.*rpc timeout/,
			);
		});
	});

	describe("self-hosted", () => {
		it("unlocks exactly the given songs without charging credits", async () => {
			billingWith("self_hosted");
			const { client, rpc } = makeSupabase({});

			const result = await unlockEntitledSongs(client, "account-1", [
				"song-1",
				"song-2",
			]);

			expect(result).toHaveOkValue({ kind: "unlocked_self_hosted" });
			expect(rpc).toHaveBeenCalledWith("insert_song_unlocks_without_charge", {
				p_account_id: "account-1",
				p_song_ids: ["song-1", "song-2"],
				p_source: "self_hosted",
			});
		});

		it("returns an error when the unlock RPC fails", async () => {
			billingWith("self_hosted");
			const { client } = makeSupabase({
				rpcError: { code: "23514", message: "rpc constraint violation" },
			});

			const result = await unlockEntitledSongs(client, "account-1", ["song-1"]);

			expect(result).toBeErr();
			expect(Result.isError(result) && result.error.message).toMatch(
				/self_hosted unlock.*rpc constraint violation/,
			);
		});
	});

	it("returns an error without writing when billing state cannot be read", async () => {
		mockedReadBillingState.mockResolvedValue(
			Result.err(
				new DatabaseError({ code: "08006", message: "db connection failed" }),
			),
		);
		const { client, rpc } = makeSupabase({});

		const result = await unlockEntitledSongs(client, "account-1", ["song-1"]);

		expect(result).toBeErr();
		expect(Result.isError(result) && result.error.message).toMatch(
			/billing state.*db connection failed/i,
		);
		expect(rpc).not.toHaveBeenCalled();
	});
});

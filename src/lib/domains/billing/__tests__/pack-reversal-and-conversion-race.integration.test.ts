/**
 * RPC integration: reverse_pack_entitlement idempotency and
 * prepare_subscription_upgrade_conversion race-safety.
 *
 * Covers the billing hardening migration
 *   supabase/migrations/20260519140000_harden_pack_reversal_and_conversion_races.sql
 *
 * Auto-skipped when SUPABASE_URL is not the local URL so CI environments
 * without a local stack are unaffected. Builds the admin client from
 * process.env directly because `createAdminSupabaseClient` reads through
 * a t3-env wrapper gated on `typeof window === 'undefined'` (vitest jsdom
 * defines `window` and would refuse the read).
 */

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

let ACCOUNT_ID: string;
const SONG_IDS: string[] = [];

async function seedAccount(initialBalance: number) {
	ACCOUNT_ID = crypto.randomUUID();
	SONG_IDS.length = 0;

	await client()
		.from("account")
		.insert({ id: ACCOUNT_ID, spotify_id: `test-${ACCOUNT_ID}` })
		.throwOnError();

	await client()
		.from("account_billing")
		.insert({
			account_id: ACCOUNT_ID,
			plan: "free",
			subscription_status: "none",
			credit_balance: initialBalance,
		})
		.throwOnError();
}

async function seedSongs(count: number): Promise<string[]> {
	const ids = Array.from({ length: count }, () => crypto.randomUUID());
	const rows = ids.map((id) => ({
		id,
		spotify_id: `sp-${id}`,
		name: `Test Song ${id}`,
		artists: ["Tester"],
		artist_ids: ["art"],
		genres: [],
	}));
	await client().from("song").insert(rows).throwOnError();
	SONG_IDS.push(...ids);
	return ids;
}

async function teardownFixtures() {
	if (!supabase) return;
	// account CASCADE clears account_billing, pack_credit_lot,
	// credit_transaction, account_song_unlock, and conversion rows.
	await supabase.from("account").delete().eq("id", ACCOUNT_ID);
	if (SONG_IDS.length > 0) {
		await supabase.from("song").delete().in("id", SONG_IDS);
	}
}

async function seedPackLot(args: {
	stripeEventId: string;
	originalCredits: number;
	remainingCredits: number;
	priceCents: number;
}) {
	await client()
		.from("pack_credit_lot")
		.insert({
			account_id: ACCOUNT_ID,
			stripe_event_id: args.stripeEventId,
			offer_id: "test-pack",
			original_credits: args.originalCredits,
			remaining_credits: args.remainingCredits,
			price_cents: args.priceCents,
		})
		.throwOnError();
}

async function seedPackUnlocks(args: {
	stripeEventId: string;
	songIds: string[];
}) {
	const rows = args.songIds.map((song_id) => ({
		account_id: ACCOUNT_ID,
		song_id,
		source: "pack",
		granted_stripe_event_id: args.stripeEventId,
	}));
	await client().from("account_song_unlock").insert(rows).throwOnError();
}

async function readBalance(): Promise<number> {
	const { data, error } = await client()
		.from("account_billing")
		.select("credit_balance")
		.eq("account_id", ACCOUNT_ID)
		.single();
	if (error) throw error;
	return data.credit_balance;
}

describe.skipIf(!IS_LOCAL)("reverse_pack_entitlement idempotency", () => {
	beforeEach(async () => {
		await seedAccount(10);
	});
	afterEach(async () => {
		await teardownFixtures();
	});

	it("first reversal subtracts remaining credits and only revokes the target pack's unlocks; second reversal is a no-op", async () => {
		const sb = client();
		const songsA = await seedSongs(5);
		const songsB = await seedSongs(5);

		await seedPackLot({
			stripeEventId: "evt_pack_A",
			originalCredits: 5,
			remainingCredits: 5,
			priceCents: 500,
		});
		await seedPackLot({
			stripeEventId: "evt_pack_B",
			originalCredits: 5,
			remainingCredits: 5,
			priceCents: 500,
		});
		await seedPackUnlocks({ stripeEventId: "evt_pack_A", songIds: songsA });
		await seedPackUnlocks({ stripeEventId: "evt_pack_B", songIds: songsB });

		// First reversal of pack A.
		const first = await sb.rpc("reverse_pack_entitlement", {
			p_account_id: ACCOUNT_ID,
			p_pack_stripe_event_id: "evt_pack_A",
			p_stripe_event_id: "evt_refund_A_1",
			p_reason: "refund",
		});
		expect(first.error).toBeNull();
		expect(first.data).toMatchObject({ credits_reversed: 5 });

		expect(await readBalance()).toBe(5);

		const { data: lotARowAfterFirst } = await sb
			.from("pack_credit_lot")
			.select("remaining_credits, reversed_at")
			.eq("stripe_event_id", "evt_pack_A")
			.single();
		expect(lotARowAfterFirst?.remaining_credits).toBe(0);
		expect(lotARowAfterFirst?.reversed_at).not.toBeNull();

		const { count: activePackBAfterFirst } = await sb
			.from("account_song_unlock")
			.select("id", { count: "exact", head: true })
			.eq("account_id", ACCOUNT_ID)
			.eq("granted_stripe_event_id", "evt_pack_B")
			.is("revoked_at", null);
		expect(activePackBAfterFirst).toBe(5);

		// Second reversal of the same pack must be a no-op.
		const second = await sb.rpc("reverse_pack_entitlement", {
			p_account_id: ACCOUNT_ID,
			p_pack_stripe_event_id: "evt_pack_A",
			p_stripe_event_id: "evt_refund_A_2",
			p_reason: "refund",
		});
		expect(second.error).toBeNull();
		expect(second.data).toEqual({
			credits_reversed: 0,
			revoked_song_ids: [],
		});

		expect(await readBalance()).toBe(5);

		// Only one refund transaction should exist for the pack.
		const { data: refundTxns } = await sb
			.from("credit_transaction")
			.select("amount, reason, stripe_event_id, metadata")
			.eq("account_id", ACCOUNT_ID)
			.eq("reason", "refund");
		expect(refundTxns).toHaveLength(1);
		expect(refundTxns?.[0]?.stripe_event_id).toBe("evt_refund_A_1");

		// Pack B unlocks must still be active after the second reversal —
		// this is the regression the reversed_at gate prevents.
		const { count: activePackBAfterSecond } = await sb
			.from("account_song_unlock")
			.select("id", { count: "exact", head: true })
			.eq("account_id", ACCOUNT_ID)
			.eq("granted_stripe_event_id", "evt_pack_B")
			.is("revoked_at", null);
		expect(activePackBAfterSecond).toBe(5);
	});
});

describe.skipIf(!IS_LOCAL)(
	"prepare_subscription_upgrade_conversion race-safety",
	() => {
		beforeEach(async () => {
			await seedAccount(0);
		});
		afterEach(async () => {
			await teardownFixtures();
		});

		it("concurrent prepare calls return the same conversion_id without surfacing unique_violation", async () => {
			const sb = client();
			const CONCURRENCY = 5;

			// Note: Supabase REST inserts HTTP latency between calls, so a true
			// parallel SQL race is not deterministic from JS. This still exercises
			// the EXCEPTION-WHEN-unique_violation handler under realistic load.
			// For deterministic verification, see the migration's two-session
			// psql notes.
			const results = await Promise.all(
				Array.from({ length: CONCURRENCY }, () =>
					sb.rpc("prepare_subscription_upgrade_conversion", {
						p_account_id: ACCOUNT_ID,
						p_target_plan: "quarterly",
					}),
				),
			);

			for (const result of results) {
				expect(result.error).toBeNull();
				expect(result.data).toBeTruthy();
			}

			const conversionIds = results.map(
				(r) => r.data?.[0]?.conversion_id ?? null,
			);
			expect(conversionIds.every((id) => id !== null)).toBe(true);
			expect(new Set(conversionIds).size).toBe(1);

			const { data: pendingRows, error: pendingErr } = await sb
				.from("subscription_credit_conversion")
				.select("id, status")
				.eq("account_id", ACCOUNT_ID);
			expect(pendingErr).toBeNull();
			expect(pendingRows).toHaveLength(1);
			expect(pendingRows?.[0]?.status).toBe("pending");
			expect(pendingRows?.[0]?.id).toBe(conversionIds[0]);
		});

		it("a subsequent prepare call after a pending row exists returns the existing conversion via the fast path", async () => {
			const sb = client();

			const first = await sb.rpc("prepare_subscription_upgrade_conversion", {
				p_account_id: ACCOUNT_ID,
				p_target_plan: "quarterly",
			});
			expect(first.error).toBeNull();
			const firstId = first.data?.[0]?.conversion_id;
			expect(firstId).toBeTruthy();

			const second = await sb.rpc("prepare_subscription_upgrade_conversion", {
				p_account_id: ACCOUNT_ID,
				p_target_plan: "quarterly",
			});
			expect(second.error).toBeNull();
			expect(second.data?.[0]?.conversion_id).toBe(firstId);

			const { data: rows } = await sb
				.from("subscription_credit_conversion")
				.select("id")
				.eq("account_id", ACCOUNT_ID);
			expect(rows).toHaveLength(1);
		});
	},
);

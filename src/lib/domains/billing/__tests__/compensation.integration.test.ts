/**
 * RPC integration: grant_analysis_failure_replacement_credit.
 *
 * Verifies eligibility gating + idempotency against the local Supabase
 * Postgres. Auto-skipped when SUPABASE_URL is not the local URL so CI
 * environments without a local stack are unaffected.
 *
 * Builds the admin client from process.env directly because the production
 * `createAdminSupabaseClient` reads through the t3-env wrapper, which gates
 * server-only vars on `typeof window === 'undefined'`. The vitest default
 * jsdom env defines `window`, so the wrapper would refuse the read here.
 */

import { createClient } from "@supabase/supabase-js";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/data/database.types";
import { grantAnalysisFailureReplacementCredit } from "../compensation";

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

let ACCOUNT_ID: string;
let SONG_ID: string;

async function seedAccount() {
	if (!supabase) throw new Error("supabase client not initialised");

	ACCOUNT_ID = crypto.randomUUID();
	SONG_ID = crypto.randomUUID();

	await supabase
		.from("account")
		.insert({ id: ACCOUNT_ID, spotify_id: `test-${ACCOUNT_ID}` })
		.throwOnError();

	await supabase
		.from("account_billing")
		.insert({
			account_id: ACCOUNT_ID,
			plan: "free",
			subscription_status: "none",
			credit_balance: 0,
		})
		.throwOnError();

	await supabase
		.from("song")
		.insert({
			id: SONG_ID,
			spotify_id: `sp-${SONG_ID}`,
			name: "Compensation Test Song",
			artists: ["Tester"],
			artist_ids: ["art"],
			genres: [],
		})
		.throwOnError();
}

async function teardownFixtures() {
	if (!supabase) return;
	await supabase.from("account").delete().eq("id", ACCOUNT_ID);
	await supabase.from("song").delete().eq("id", SONG_ID);
}

async function insertUnlock(args: {
	source: "pack" | "free_auto";
	revoked: boolean;
}) {
	if (!supabase) throw new Error("supabase client not initialised");
	await supabase
		.from("account_song_unlock")
		.insert({
			account_id: ACCOUNT_ID,
			song_id: SONG_ID,
			source: args.source,
			revoked_at: args.revoked ? new Date().toISOString() : null,
			revoked_reason: args.revoked ? "admin" : null,
		})
		.throwOnError();
}

async function readBalance(): Promise<number> {
	if (!supabase) throw new Error("supabase client not initialised");
	const { data, error } = await supabase
		.from("account_billing")
		.select("credit_balance")
		.eq("account_id", ACCOUNT_ID)
		.single();
	if (error) throw error;
	return data.credit_balance;
}

describe.skipIf(!IS_LOCAL)("grant_analysis_failure_replacement_credit", () => {
	beforeEach(async () => {
		await seedAccount();
	});
	afterEach(async () => {
		await teardownFixtures();
	});

	it("grants 1 credit and records a replacement_grant ledger row for an active pack unlock", async () => {
		if (!supabase) throw new Error("supabase client not initialised");
		await insertUnlock({ source: "pack", revoked: false });

		const before = await readBalance();
		expect(before).toBe(0);

		const result = await grantAnalysisFailureReplacementCredit(supabase, {
			accountId: ACCOUNT_ID,
			songId: SONG_ID,
			failureCode: "analysis_inputs_missing",
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({
			kind: "granted",
			credits: 1,
			newBalance: 1,
		});

		const after = await readBalance();
		expect(after).toBe(1);

		const { data: txns, error: txnError } = await supabase
			.from("credit_transaction")
			.select("amount, reason")
			.eq("account_id", ACCOUNT_ID);
		expect(txnError).toBeNull();
		expect(txns).toEqual([{ amount: 1, reason: "replacement_grant" }]);

		const { data: comps, error: compError } = await supabase
			.from("song_failure_compensation")
			.select("song_id, failure_code, credit_amount")
			.eq("account_id", ACCOUNT_ID);
		expect(compError).toBeNull();
		expect(comps).toEqual([
			{
				song_id: SONG_ID,
				failure_code: "analysis_inputs_missing",
				credit_amount: 1,
			},
		]);
	});

	it("is idempotent: second call for the same (account, song, failure_code) returns already_compensated and does not change balance", async () => {
		if (!supabase) throw new Error("supabase client not initialised");
		await insertUnlock({ source: "pack", revoked: false });

		const first = await grantAnalysisFailureReplacementCredit(supabase, {
			accountId: ACCOUNT_ID,
			songId: SONG_ID,
			failureCode: "analysis_inputs_missing",
		});
		expect(Result.isOk(first)).toBe(true);
		if (!Result.isOk(first)) return;
		expect(first.value.kind).toBe("granted");

		const balanceAfterFirst = await readBalance();
		expect(balanceAfterFirst).toBe(1);

		const second = await grantAnalysisFailureReplacementCredit(supabase, {
			accountId: ACCOUNT_ID,
			songId: SONG_ID,
			failureCode: "analysis_inputs_missing",
		});
		expect(Result.isOk(second)).toBe(true);
		if (!Result.isOk(second)) return;
		expect(second.value).toEqual({ kind: "already_compensated" });

		const balanceAfterSecond = await readBalance();
		expect(balanceAfterSecond).toBe(1);

		const { data: txns } = await supabase
			.from("credit_transaction")
			.select("amount, reason")
			.eq("account_id", ACCOUNT_ID);
		expect(txns).toHaveLength(1);
	});

	it("is not eligible when the unlock is non-pack source", async () => {
		if (!supabase) throw new Error("supabase client not initialised");
		await insertUnlock({ source: "free_auto", revoked: false });

		const result = await grantAnalysisFailureReplacementCredit(supabase, {
			accountId: ACCOUNT_ID,
			songId: SONG_ID,
			failureCode: "analysis_inputs_missing",
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({ kind: "not_eligible" });
		expect(await readBalance()).toBe(0);
	});

	it("is not eligible when the pack unlock has been revoked", async () => {
		if (!supabase) throw new Error("supabase client not initialised");
		await insertUnlock({ source: "pack", revoked: true });

		const result = await grantAnalysisFailureReplacementCredit(supabase, {
			accountId: ACCOUNT_ID,
			songId: SONG_ID,
			failureCode: "analysis_inputs_missing",
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({ kind: "not_eligible" });
		expect(await readBalance()).toBe(0);
	});

	it("is not eligible for non-terminal failure codes even with an active pack unlock", async () => {
		if (!supabase) throw new Error("supabase client not initialised");
		await insertUnlock({ source: "pack", revoked: false });

		const result = await grantAnalysisFailureReplacementCredit(supabase, {
			accountId: ACCOUNT_ID,
			songId: SONG_ID,
			failureCode: "analysis_inputs_unconfirmed_lyrics",
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({ kind: "not_eligible" });
		expect(await readBalance()).toBe(0);
	});
});

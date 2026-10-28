/**
 * Concurrent first-creates only race on the real unique(account_id)
 * constraint, so only a real database can prove them conflict-safe.
 * Auto-skipped unless SUPABASE_URL is the local stack.
 */

import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/data/database.types";
import { getOrCreatePreferences } from "@/lib/domains/library/accounts/preferences-queries";

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

function db() {
	if (!supabase) throw new Error("supabase client not initialised");
	return supabase;
}

const describeLocal = IS_LOCAL ? describe : describe.skip;

const seeded: string[] = [];

async function seedAccountWithoutPreferences(): Promise<string> {
	const accountId = crypto.randomUUID();
	seeded.push(accountId);
	await db()
		.from("account")
		.insert({ id: accountId, spotify_id: `test-${accountId}` })
		.throwOnError();
	return accountId;
}

afterEach(async () => {
	if (!supabase) return;
	while (seeded.length > 0) {
		const id = seeded.pop();
		if (id) await db().from("account").delete().eq("id", id);
	}
});

describeLocal("getOrCreatePreferences", () => {
	it("regression: concurrent first creates all return the one row instead of a unique violation", async () => {
		const accountId = await seedAccountWithoutPreferences();

		const results = await Promise.all(
			Array.from({ length: 8 }, () => getOrCreatePreferences(accountId)),
		);

		for (const result of results) expect(result).toBeOk();
		const ids = results.map((result) => result.unwrap().id);
		expect(new Set(ids).size).toBe(1);

		const { data } = await db()
			.from("user_preferences")
			.select("id")
			.eq("account_id", accountId)
			.throwOnError();
		expect(data).toHaveLength(1);
	});
});

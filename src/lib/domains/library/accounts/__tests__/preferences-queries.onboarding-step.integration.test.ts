/**
 * The step writer's compare-and-set guard lives in the SQL predicate, so only
 * a real database can prove it. Auto-skipped unless SUPABASE_URL is the local
 * stack.
 */

import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/data/database.types";
import type { OnboardingStep } from "@/lib/domains/library/accounts/onboarding-steps";
import {
	enterSongWalkthrough,
	updateOnboardingStep,
} from "@/lib/domains/library/accounts/preferences-queries";

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

async function seedPreferences(opts: {
	step: OnboardingStep;
	completedAt: string | null;
}): Promise<string> {
	const accountId = crypto.randomUUID();
	seeded.push(accountId);
	await db()
		.from("account")
		.insert({ id: accountId, spotify_id: `test-${accountId}` })
		.throwOnError();
	await db()
		.from("user_preferences")
		.insert({
			account_id: accountId,
			onboarding_step: opts.step,
			onboarding_completed_at: opts.completedAt,
		})
		.throwOnError();
	return accountId;
}

async function readPreferences(accountId: string) {
	const { data } = await db()
		.from("user_preferences")
		.select("onboarding_step, onboarding_completed_at")
		.eq("account_id", accountId)
		.single()
		.throwOnError();
	return data;
}

afterEach(async () => {
	if (!supabase) return;
	while (seeded.length > 0) {
		const id = seeded.pop();
		if (id) await db().from("account").delete().eq("id", id);
	}
});

describeLocal("updateOnboardingStep", () => {
	it("regression: a step save after completion does not reopen onboarding", async () => {
		const completedAt = "2026-10-01T12:00:00+00:00";
		const accountId = await seedPreferences({
			step: "plan-selection",
			completedAt,
		});

		const result = await updateOnboardingStep(accountId, "pick-color");

		expect(result).toHaveOkValue(null);
		const prefs = await readPreferences(accountId);
		expect(new Date(prefs.onboarding_completed_at ?? "").toISOString()).toBe(
			new Date(completedAt).toISOString(),
		);
		expect(prefs.onboarding_step).toBe("plan-selection");
	});

	it("moves the step while onboarding is still open", async () => {
		const accountId = await seedPreferences({
			step: "pick-color",
			completedAt: null,
		});

		const result = await updateOnboardingStep(accountId, "plan-selection");

		expect(result).toBeOk();
		const prefs = await readPreferences(accountId);
		expect(prefs.onboarding_step).toBe("plan-selection");
		expect(prefs.onboarding_completed_at).toBeNull();
	});

	it("regression: entering the walkthrough after completion changes nothing", async () => {
		const completedAt = "2026-10-01T12:00:00+00:00";
		const accountId = await seedPreferences({
			step: "plan-selection",
			completedAt,
		});

		// No song row needed: the guarded UPDATE matches no row, so no FK check.
		const result = await enterSongWalkthrough(accountId, crypto.randomUUID());

		expect(result).toHaveOkValue(null);
		const prefs = await readPreferences(accountId);
		expect(prefs.onboarding_step).toBe("plan-selection");
	});
});

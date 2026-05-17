/**
 * Pending excludes terminal failures.
 *
 * Exercises the SQL change in migration
 * 20260426150000_pending_excludes_terminal_failures: a terminally failed
 * entitled song with no account_item_newness row must NOT count as pending in
 * get_liked_songs_stats and must NOT be returned by p_filter='pending' in
 * get_liked_songs_page.
 *
 * Runs against the local Supabase Postgres only — auto-skipped when
 * SUPABASE_URL is not the local URL so CI without a local stack is unaffected.
 *
 * Constructs the admin client from process.env directly because the
 * production `createAdminSupabaseClient` reads through the t3-env wrapper,
 * which gates server-only vars on `typeof window === 'undefined'`. The
 * vitest default jsdom env defines `window`, so the wrapper would refuse
 * the read here — bypassing it for this one integration entry point keeps
 * the suite-wide jsdom setup intact.
 */

import { createClient } from "@supabase/supabase-js";
import { Result } from "better-result";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => supabase,
}));

const likedSongs = await import("../queries");

// Unique-per-run account id keeps parallel test runs isolated and lets a
// single `DELETE FROM account WHERE id = ...` cascade-clean every fixture
// row this test inserts (liked_song, account_billing, unlocks, jobs, ...).
const ACCOUNT_ID = crypto.randomUUID();
const SONG_PENDING_ID = crypto.randomUUID();
const SONG_FAILED_ID = crypto.randomUUID();
const SONG_LOCKED_ID = crypto.randomUUID();

async function setupFixtures() {
	if (!supabase) throw new Error("supabase client not initialised");

	await supabase
		.from("account")
		.insert({ id: ACCOUNT_ID, spotify_id: `test-${ACCOUNT_ID}` })
		.throwOnError();

	await supabase
		.from("account_billing")
		.insert({
			account_id: ACCOUNT_ID,
			plan: "free",
			unlimited_access_source: null,
			subscription_status: "none",
		})
		.throwOnError();

	await supabase
		.from("song")
		.insert([
			{
				id: SONG_PENDING_ID,
				spotify_id: `sp-pending-${SONG_PENDING_ID}`,
				name: "Pending Song",
				artists: ["Artist A"],
				artist_ids: ["art-1"],
			},
			{
				id: SONG_FAILED_ID,
				spotify_id: `sp-failed-${SONG_FAILED_ID}`,
				name: "Failed Song",
				artists: ["Artist B"],
				artist_ids: ["art-2"],
			},
			{
				id: SONG_LOCKED_ID,
				spotify_id: `sp-locked-${SONG_LOCKED_ID}`,
				name: "Locked Song",
				artists: ["Artist C"],
				artist_ids: ["art-3"],
			},
		])
		.throwOnError();

	const likedAt = new Date().toISOString();
	await supabase
		.from("liked_song")
		.insert([
			{ account_id: ACCOUNT_ID, song_id: SONG_PENDING_ID, liked_at: likedAt },
			{ account_id: ACCOUNT_ID, song_id: SONG_FAILED_ID, liked_at: likedAt },
			{ account_id: ACCOUNT_ID, song_id: SONG_LOCKED_ID, liked_at: likedAt },
		])
		.throwOnError();

	// Entitle the two non-locked songs only.
	await supabase
		.from("account_song_unlock")
		.insert([
			{ account_id: ACCOUNT_ID, song_id: SONG_PENDING_ID, source: "free_auto" },
			{ account_id: ACCOUNT_ID, song_id: SONG_FAILED_ID, source: "free_auto" },
		])
		.throwOnError();

	const { data: jobRow } = await supabase
		.from("job")
		.insert({ account_id: ACCOUNT_ID, type: "song_analysis", status: "failed" })
		.select("id")
		.single()
		.throwOnError();

	if (!jobRow) throw new Error("failed to insert job fixture");

	// Terminal failure for the failed-but-entitled song. The pending bucket /
	// pending filter must skip it from now on.
	await supabase
		.from("job_item_failure")
		.insert({
			job_id: jobRow.id,
			item_type: "song",
			item_id: SONG_FAILED_ID,
			stage: "song_analysis",
			failure_code: "validation",
			is_terminal: true,
		})
		.throwOnError();
}

async function teardownFixtures() {
	if (!supabase) return;
	// account FK is ON DELETE CASCADE — wipes liked_song, account_billing,
	// account_song_unlock, job (and through job → job_item_failure).
	await supabase.from("account").delete().eq("id", ACCOUNT_ID);
	await supabase
		.from("song")
		.delete()
		.in("id", [SONG_PENDING_ID, SONG_FAILED_ID, SONG_LOCKED_ID]);
}

describe.skipIf(!IS_LOCAL)("pending excludes terminal failures", () => {
	beforeAll(setupFixtures);
	afterAll(teardownFixtures);

	it("get_liked_songs_stats: terminally failed entitled song is not pending", async () => {
		const result = await likedSongs.getStats(ACCOUNT_ID);
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const stats = result.value;
		expect(Number(stats.total)).toBe(3);
		expect(Number(stats.locked)).toBe(1);
		// Only SONG_PENDING_ID should be pending — SONG_FAILED_ID is terminal,
		// SONG_LOCKED_ID is not entitled.
		expect(Number(stats.pending)).toBe(1);
	});

	it("get_liked_songs_page p_filter=pending excludes terminal failures and locked", async () => {
		const result = await likedSongs.getPageWithDetails(ACCOUNT_ID, {
			filter: "pending",
			limit: 50,
		});
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const ids = result.value.items.map((row) => row.song_id);
		expect(ids).toEqual([SONG_PENDING_ID]);
	});

	it("display_state on the page row reflects failed/pending/locked", async () => {
		const result = await likedSongs.getPageWithDetails(ACCOUNT_ID, {
			filter: "all",
			limit: 50,
		});
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const byId = new Map(
			result.value.items.map((row) => [row.song_id, row.display_state]),
		);
		expect(byId.get(SONG_PENDING_ID)).toBe("pending");
		expect(byId.get(SONG_FAILED_ID)).toBe("failed");
		expect(byId.get(SONG_LOCKED_ID)).toBe("locked");
	});
});

/**
 * The per-song analysis read behind the liked-songs detail panel. List rows no
 * longer carry the analysis, so this read is now the only path the panel gets
 * it through, and it must apply the same entitlement gate the rows did.
 *
 * Runs against the local Supabase Postgres only — auto-skipped when SUPABASE_URL
 * is not the local URL (see slug-resolution.integration.test.ts).
 */

import { createClient } from "@supabase/supabase-js";
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

const { getAnalysisBySongId } = await import("../queries");

const ACCOUNT_ID = crypto.randomUUID();
const OTHER_ACCOUNT_ID = crypto.randomUUID();
const UNLOCKED = crypto.randomUUID();
const LOCKED = crypto.randomUUID();
const UNLIKED = crypto.randomUUID();
const SONG_IDS = [UNLOCKED, LOCKED, UNLIKED];
const ANALYSIS = { headline: "stored read" };

async function seed() {
	if (!supabase) throw new Error("supabase client not initialised");

	await supabase
		.from("account")
		.insert([
			{ id: ACCOUNT_ID, spotify_id: `test-${ACCOUNT_ID}` },
			{ id: OTHER_ACCOUNT_ID, spotify_id: `test-${OTHER_ACCOUNT_ID}` },
		])
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
		.insert(
			SONG_IDS.map((id) => ({
				id,
				spotify_id: `sp-${id}`,
				name: `Song ${id}`,
				artists: ["Analysis Artist"],
				artist_ids: [`art-${id}`],
			})),
		)
		.throwOnError();
	await supabase
		.from("song_analysis")
		.insert(
			SONG_IDS.map((song_id) => ({
				song_id,
				analysis: ANALYSIS,
				model: "test-model",
			})),
		)
		.throwOnError();
	await supabase
		.from("liked_song")
		.insert([
			{ account_id: ACCOUNT_ID, song_id: UNLOCKED, liked_at: "2026-01-03" },
			{ account_id: ACCOUNT_ID, song_id: LOCKED, liked_at: "2026-01-02" },
			{
				account_id: ACCOUNT_ID,
				song_id: UNLIKED,
				liked_at: "2026-01-01",
				unliked_at: "2026-01-04",
			},
		])
		.throwOnError();
	await supabase
		.from("account_song_unlock")
		.insert(
			[UNLOCKED, UNLIKED].map((song_id) => ({
				account_id: ACCOUNT_ID,
				song_id,
				source: "free_auto",
			})),
		)
		.throwOnError();
}

describe.skipIf(!IS_LOCAL)("getAnalysisBySongId", () => {
	beforeAll(seed);

	afterAll(async () => {
		if (!supabase) return;
		// account FK is ON DELETE CASCADE — clears liked_song, unlocks, billing.
		await supabase
			.from("account")
			.delete()
			.in("id", [ACCOUNT_ID, OTHER_ACCOUNT_ID])
			.throwOnError();
		await supabase.from("song").delete().in("id", SONG_IDS).throwOnError();
	});

	it("returns an unlocked liked song's stored analysis", async () => {
		const row = (await getAnalysisBySongId(ACCOUNT_ID, UNLOCKED)).unwrap();

		expect(row?.analysis_id).toEqual(expect.any(String));
		expect(row?.analysis_content).toEqual(ANALYSIS);
	});

	it("never returns a locked song's analysis, though one is stored", async () => {
		const row = (await getAnalysisBySongId(ACCOUNT_ID, LOCKED)).unwrap();

		expect(row).not.toBeNull();
		expect(row?.analysis_id).toBeNull();
		expect(row?.analysis_content).toBeNull();
	});

	it("returns nothing for a song the account unliked or never liked", async () => {
		expect(
			(await getAnalysisBySongId(ACCOUNT_ID, UNLIKED)).unwrap(),
		).toBeNull();
		expect(
			(await getAnalysisBySongId(OTHER_ACCOUNT_ID, UNLOCKED)).unwrap(),
		).toBeNull();
	});
});

/**
 * Entitled candidate selector — entitlement gate for "newly ready" detection.
 *
 * Guards the fix for the enrichment orchestrator's `newCandidatesAvailable`
 * signal. That signal used to be computed by a hand-rolled TypeScript readiness
 * check that omitted the entitlement gate, so a locked or revoked song that
 * gained genres + analysis + embedding could be wrongly counted as a new match
 * candidate. The orchestrator now routes the before/after diff through
 * select_entitled_data_enriched_liked_song_ids, so the entitlement gate below
 * is the invariant that keeps that bug from returning: a fully data-enriched
 * song is included only when the account is actually entitled to it.
 *
 * Runs against the local Supabase Postgres only — auto-skipped when SUPABASE_URL
 * is not the local URL so CI without a local stack is unaffected.
 *
 * Builds the admin client from process.env directly because the production
 * `createAdminSupabaseClient` reads through the t3-env wrapper, which gates
 * server-only vars on `typeof window === 'undefined'`. The vitest default jsdom
 * env defines `window`, so the wrapper would refuse the read here.
 */

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const ACCOUNT_ID = crypto.randomUUID();
const SONG_ENTITLED_READY_ID = crypto.randomUUID();
const SONG_LOCKED_READY_ID = crypto.randomUUID();
const SONG_REVOKED_READY_ID = crypto.randomUUID();

// pgvector accepts a string literal of the form "[v1,v2,...]". Match the
// declared dimension on song_embedding (512).
const ZERO_VECTOR = `[${new Array(512).fill(0).join(",")}]`;

const ALL_SONG_IDS = [
	SONG_ENTITLED_READY_ID,
	SONG_LOCKED_READY_ID,
	SONG_REVOKED_READY_ID,
];

async function setupFixtures() {
	if (!supabase) throw new Error("supabase client not initialised");

	await supabase
		.from("account")
		.insert({ id: ACCOUNT_ID, spotify_id: `test-${ACCOUNT_ID}` })
		.throwOnError();

	// Free plan, no unlimited access — entitlement therefore depends entirely on
	// per-song unlock rows, which is the case the gate must enforce.
	await supabase
		.from("account_billing")
		.insert({
			account_id: ACCOUNT_ID,
			plan: "free",
			unlimited_access_source: null,
			subscription_status: "none",
		})
		.throwOnError();

	// All three songs are fully data-enriched (genres + analysis + embedding).
	// They differ ONLY in entitlement, isolating the gate under test.
	await supabase
		.from("song")
		.insert(
			ALL_SONG_IDS.map((id, index) => ({
				id,
				spotify_id: `sp-${id}`,
				name: `Ready Song ${index}`,
				artists: ["Artist"],
				artist_ids: ["art-1"],
				genres: ["rock"],
			})),
		)
		.throwOnError();

	const likedAt = new Date().toISOString();
	await supabase
		.from("liked_song")
		.insert(
			ALL_SONG_IDS.map((song_id) => ({
				account_id: ACCOUNT_ID,
				song_id,
				liked_at: likedAt,
			})),
		)
		.throwOnError();

	await supabase
		.from("song_analysis")
		.insert(
			ALL_SONG_IDS.map((song_id) => ({
				song_id,
				analysis: { mood: ["test"] },
				model: "test-model",
			})),
		)
		.throwOnError();

	await supabase
		.from("song_embedding")
		.insert(
			ALL_SONG_IDS.map((song_id) => ({
				song_id,
				kind: "song_semantic" as const,
				model: "test-embed-model",
				dims: 512,
				content_hash: `hash-${song_id}`,
				embedding: ZERO_VECTOR,
			})),
		)
		.throwOnError();

	// Entitlement differences:
	//   - entitled song: active (non-revoked) unlock
	//   - revoked song:  unlock row exists but is revoked
	//   - locked song:   no unlock row at all
	await supabase
		.from("account_song_unlock")
		.insert([
			{
				account_id: ACCOUNT_ID,
				song_id: SONG_ENTITLED_READY_ID,
				source: "free_auto",
			},
			{
				account_id: ACCOUNT_ID,
				song_id: SONG_REVOKED_READY_ID,
				source: "free_auto",
				revoked_at: new Date().toISOString(),
			},
		])
		.throwOnError();
}

async function teardownFixtures() {
	if (!supabase) return;
	// account FK cascade wipes liked_song, account_billing, unlocks; song FK
	// cascade wipes song_analysis and song_embedding.
	await supabase.from("account").delete().eq("id", ACCOUNT_ID).throwOnError();
	await supabase.from("song").delete().in("id", ALL_SONG_IDS).throwOnError();
}

describe.skipIf(!IS_LOCAL)(
	"select_entitled_data_enriched_liked_song_ids: entitlement gate",
	() => {
		beforeAll(setupFixtures);
		afterAll(teardownFixtures);

		async function selectEntitledReadyIds(): Promise<string[]> {
			if (!supabase) throw new Error("supabase client not initialised");
			const { data, error } = await supabase.rpc(
				"select_entitled_data_enriched_liked_song_ids",
				{ p_account_id: ACCOUNT_ID },
			);
			expect(error).toBeNull();
			return (data ?? []).map((row) => row.song_id);
		}

		it("includes a data-enriched song the account is entitled to", async () => {
			expect(await selectEntitledReadyIds()).toContain(SONG_ENTITLED_READY_ID);
		});

		it("excludes a data-enriched song the account is not entitled to (no unlock)", async () => {
			expect(await selectEntitledReadyIds()).not.toContain(
				SONG_LOCKED_READY_ID,
			);
		});

		it("excludes a data-enriched song whose unlock was revoked", async () => {
			expect(await selectEntitledReadyIds()).not.toContain(
				SONG_REVOKED_READY_ID,
			);
		});
	},
);

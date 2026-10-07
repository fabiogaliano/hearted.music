/**
 * Match-filter option aggregates — exercises migration
 * 20261007100000_match_filter_options_for_entitled_songs through
 * readMatchFilterOptions: the entitled population, the per-song language
 * dedupe, and UTC bucketing of liked_at all live in SQL, so only real Postgres
 * can catch a regression in them.
 *
 * Runs against the local Supabase Postgres only — auto-skipped when
 * SUPABASE_URL is not the local URL so CI without a local stack is unaffected.
 */

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/data/database.types";
import { readMatchFilterOptions } from "../filter-options-queries";

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
const SAME_LANGUAGE_TWICE_ID = crypto.randomUUID();
const BILINGUAL_ID = crypto.randomUUID();
const NOT_ENTITLED_ID = crypto.randomUUID();
const SONG_IDS = [SAME_LANGUAGE_TWICE_ID, BILINGUAL_ID, NOT_ENTITLED_ID];

const ZERO_VECTOR = `[${new Array(512).fill(0).join(",")}]`;

function db() {
	if (!supabase) throw new Error("supabase client not initialised");
	return supabase;
}

async function setupFixtures() {
	await db()
		.from("account")
		.insert({ id: ACCOUNT_ID, spotify_id: `test-${ACCOUNT_ID}` })
		.throwOnError();

	await db()
		.from("account_billing")
		.insert({
			account_id: ACCOUNT_ID,
			plan: "free",
			unlimited_access_source: null,
			subscription_status: "none",
		})
		.throwOnError();

	await db()
		.from("song")
		.insert([
			{
				id: SAME_LANGUAGE_TWICE_ID,
				spotify_id: `sp-${SAME_LANGUAGE_TWICE_ID}`,
				name: "Same Language Twice",
				artists: ["Artist A"],
				artist_ids: ["art-a"],
				genres: ["rock"],
				language: "en",
				language_secondary: "en",
				release_year: 1999,
			},
			{
				id: BILINGUAL_ID,
				spotify_id: `sp-${BILINGUAL_ID}`,
				name: "Bilingual",
				artists: ["Artist B"],
				artist_ids: ["art-b"],
				genres: ["pop"],
				language: "en",
				language_secondary: "pt",
				release_year: 2021,
			},
			{
				id: NOT_ENTITLED_ID,
				spotify_id: `sp-${NOT_ENTITLED_ID}`,
				name: "Locked",
				artists: ["Artist C"],
				artist_ids: ["art-c"],
				genres: ["jazz"],
				language: "ja",
				language_secondary: null,
				release_year: 1980,
			},
		])
		.throwOnError();

	await db()
		.from("liked_song")
		.insert([
			{
				account_id: ACCOUNT_ID,
				song_id: SAME_LANGUAGE_TWICE_ID,
				liked_at: "2018-06-15T10:00:00Z",
			},
			{
				// 2020-12-31 locally, but 2021-01-01T02:30Z in UTC.
				account_id: ACCOUNT_ID,
				song_id: BILINGUAL_ID,
				liked_at: "2020-12-31T23:30:00-03:00",
			},
			{
				account_id: ACCOUNT_ID,
				song_id: NOT_ENTITLED_ID,
				liked_at: "2010-01-01T00:00:00Z",
			},
		])
		.throwOnError();

	// No unlock for NOT_ENTITLED_ID: on a free plan that keeps it out of the
	// matching population despite having every enrichment artifact.
	await db()
		.from("account_song_unlock")
		.insert([
			{
				account_id: ACCOUNT_ID,
				song_id: SAME_LANGUAGE_TWICE_ID,
				source: "free_auto",
			},
			{ account_id: ACCOUNT_ID, song_id: BILINGUAL_ID, source: "free_auto" },
		])
		.throwOnError();

	await db()
		.from("song_analysis")
		.insert(
			SONG_IDS.map((songId) => ({
				song_id: songId,
				analysis: { mood: ["test"] },
				model: "test-model",
			})),
		)
		.throwOnError();

	await db()
		.from("song_embedding")
		.insert(
			SONG_IDS.map((songId) => ({
				song_id: songId,
				kind: "song_semantic",
				model: "test-embed-model",
				dims: 512,
				content_hash: `hash-${songId}`,
				embedding: ZERO_VECTOR,
			})),
		)
		.throwOnError();
}

async function teardownFixtures() {
	if (!supabase) return;
	// account cascade clears liked_song, billing and unlocks; song cascade
	// clears song_analysis and song_embedding.
	await db().from("account").delete().eq("id", ACCOUNT_ID).throwOnError();
	await db().from("song").delete().in("id", SONG_IDS).throwOnError();
}

describe.skipIf(!IS_LOCAL)("readMatchFilterOptions", () => {
	beforeAll(setupFixtures);
	afterAll(teardownFixtures);

	it("aggregates languages, release years and liked dates over the entitled songs only", async () => {
		const result = await readMatchFilterOptions(db(), ACCOUNT_ID);

		expect(result).toHaveOkValue({
			languages: [
				{ code: "en", count: 2 },
				{ code: "pt", count: 1 },
			],
			releaseYears: {
				min: 1999,
				max: 2021,
				counts: [
					{ year: 1999, count: 1 },
					{ year: 2021, count: 1 },
				],
			},
			likedAt: {
				oldest: "2018-06-15",
				yearCounts: [
					{ year: 2018, count: 1 },
					{ year: 2021, count: 1 },
				],
			},
		});
	});

	it("returns empty aggregates for an account with no entitled songs", async () => {
		const result = await readMatchFilterOptions(db(), crypto.randomUUID());

		expect(result).toHaveOkValue({
			languages: [],
			releaseYears: { min: null, max: null, counts: [] },
			likedAt: { oldest: null, yearCounts: [] },
		});
	});
});

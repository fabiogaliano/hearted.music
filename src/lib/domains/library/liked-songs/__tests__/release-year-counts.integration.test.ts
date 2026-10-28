/**
 * Release-year counts — exercises get_account_release_year_counts
 * (20261028100000) through getAccountReleaseYearAggregates. The RPC takes its
 * population from select_entitled_data_enriched_liked_song_ids, so each billing
 * shape must count exactly the songs matching sees: every data-enriched liked
 * song for unlimited access, only actively unlocked ones for a locked account.
 *
 * Runs against the local Supabase Postgres only — auto-skipped when
 * SUPABASE_URL is not the local URL so CI without a local stack is unaffected.
 *
 * The production `createAdminSupabaseClient` reads through the t3-env wrapper,
 * which refuses server-only vars under jsdom, so the client is mocked with one
 * built from process.env.
 */

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/data/database.types";
import { ACCOUNT_BILLING } from "@/test/fixtures";

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

const { getAccountReleaseYearAggregates } = await import(
	"../taste-profile-queries"
);

const SUBSCRIPTION_ID = crypto.randomUUID();
const SELF_HOSTED_ID = crypto.randomUUID();
const LOCKED_ID = crypto.randomUUID();
const ACCOUNT_IDS = [SUBSCRIPTION_ID, SELF_HOSTED_ID, LOCKED_ID];

const SONG = {
	from1999a: crypto.randomUUID(),
	from1999b: crypto.randomUUID(),
	from2021: crypto.randomUUID(),
	noReleaseYear: crypto.randomUUID(),
	noEmbedding: crypto.randomUUID(),
	noGenres: crypto.randomUUID(),
	unliked: crypto.randomUUID(),
};
const SONG_IDS = Object.values(SONG);

const ZERO_VECTOR = `[${new Array(512).fill(0).join(",")}]`;

function db() {
	if (!supabase) throw new Error("supabase client not initialised");
	return supabase;
}

function songRow(id: string, releaseYear: number | null, genres: string[]) {
	return {
		id,
		spotify_id: `sp-${id}`,
		name: `Song ${id}`,
		artists: ["Artist"],
		artist_ids: ["art-1"],
		genres,
		release_year: releaseYear,
	};
}

async function setupFixtures() {
	await db()
		.from("account")
		.insert(ACCOUNT_IDS.map((id) => ({ id, spotify_id: `test-${id}` })))
		.throwOnError();

	await db()
		.from("account_billing")
		.insert([
			{ account_id: SUBSCRIPTION_ID, ...ACCOUNT_BILLING.subscription },
			{ account_id: SELF_HOSTED_ID, ...ACCOUNT_BILLING.selfHosted },
			{ account_id: LOCKED_ID, ...ACCOUNT_BILLING.locked },
		])
		.throwOnError();

	await db()
		.from("song")
		.insert([
			songRow(SONG.from1999a, 1999, ["rock"]),
			songRow(SONG.from1999b, 1999, ["pop"]),
			songRow(SONG.from2021, 2021, ["jazz"]),
			songRow(SONG.noReleaseYear, null, ["folk"]),
			songRow(SONG.noEmbedding, 2010, ["soul"]),
			songRow(SONG.noGenres, 1985, []),
			songRow(SONG.unliked, 2005, ["funk"]),
		])
		.throwOnError();

	// Every song gets an analysis; all but noEmbedding get an embedding.
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
			SONG_IDS.filter((id) => id !== SONG.noEmbedding).map((songId) => ({
				song_id: songId,
				kind: "song_semantic",
				model: "test-embed-model",
				dims: 512,
				content_hash: `hash-${songId}`,
				embedding: ZERO_VECTOR,
			})),
		)
		.throwOnError();

	const liked = (accountId: string, songId: string, unliked = false) => ({
		account_id: accountId,
		song_id: songId,
		liked_at: "2024-01-01T00:00:00Z",
		unliked_at: unliked ? "2024-06-01T00:00:00Z" : null,
	});

	await db()
		.from("liked_song")
		.insert([
			liked(SUBSCRIPTION_ID, SONG.from1999a),
			liked(SUBSCRIPTION_ID, SONG.from1999b),
			liked(SUBSCRIPTION_ID, SONG.from2021),
			liked(SUBSCRIPTION_ID, SONG.noReleaseYear),
			liked(SUBSCRIPTION_ID, SONG.noEmbedding),
			liked(SUBSCRIPTION_ID, SONG.noGenres),
			liked(SUBSCRIPTION_ID, SONG.unliked, true),

			liked(SELF_HOSTED_ID, SONG.from1999a),
			liked(SELF_HOSTED_ID, SONG.from2021),
			liked(SELF_HOSTED_ID, SONG.noEmbedding),
			liked(SELF_HOSTED_ID, SONG.unliked, true),

			liked(LOCKED_ID, SONG.from1999a),
			liked(LOCKED_ID, SONG.from1999b),
			liked(LOCKED_ID, SONG.from2021),
		])
		.throwOnError();

	// Locked account: from1999b actively unlocked, from2021's unlock revoked,
	// from1999a never unlocked.
	await db()
		.from("account_song_unlock")
		.insert([
			{ account_id: LOCKED_ID, song_id: SONG.from1999b, source: "free_auto" },
			{
				account_id: LOCKED_ID,
				song_id: SONG.from2021,
				source: "pack",
				revoked_at: "2024-06-01T00:00:00Z",
			},
		])
		.throwOnError();
}

async function teardownFixtures() {
	if (!supabase) return;
	// account cascade clears liked_song, billing and unlocks; song cascade
	// clears song_analysis and song_embedding.
	await db().from("account").delete().in("id", ACCOUNT_IDS).throwOnError();
	await db().from("song").delete().in("id", SONG_IDS).throwOnError();
}

describe.skipIf(!IS_LOCAL)("getAccountReleaseYearAggregates", () => {
	beforeAll(setupFixtures);
	afterAll(teardownFixtures);

	it("counts every data-enriched liked song with a release year for an active subscription", async () => {
		const result = await getAccountReleaseYearAggregates(SUBSCRIPTION_ID);

		expect(result).toHaveOkValue({
			min: 1999,
			max: 2021,
			counts: [
				{ year: 1999, count: 2 },
				{ year: 2021, count: 1 },
			],
		});
	});

	it("counts every data-enriched liked song with a release year for a self-hosted account", async () => {
		const result = await getAccountReleaseYearAggregates(SELF_HOSTED_ID);

		expect(result).toHaveOkValue({
			min: 1999,
			max: 2021,
			counts: [
				{ year: 1999, count: 1 },
				{ year: 2021, count: 1 },
			],
		});
	});

	it("counts only actively unlocked songs for a locked account", async () => {
		const result = await getAccountReleaseYearAggregates(LOCKED_ID);

		expect(result).toHaveOkValue({
			min: 1999,
			max: 1999,
			counts: [{ year: 1999, count: 1 }],
		});
	});
});

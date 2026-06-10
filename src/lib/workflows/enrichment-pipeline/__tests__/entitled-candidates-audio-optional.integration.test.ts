/**
 * Entitled candidate selector — audio is optional.
 *
 * Exercises migration 20260426160000_entitled_candidates_audio_optional:
 * select_entitled_data_enriched_liked_song_ids must include an entitled song
 * that has genres + song_analysis + song_embedding even when no
 * song_audio_feature row exists, and must still exclude songs missing one of
 * the required artifacts.
 *
 * Runs against the local Supabase Postgres only — auto-skipped when
 * SUPABASE_URL is not the local URL so CI without a local stack is unaffected.
 *
 * Builds the admin client from process.env directly because the production
 * `createAdminSupabaseClient` reads through the t3-env wrapper, which gates
 * server-only vars on `typeof window === 'undefined'`. The vitest default
 * jsdom env defines `window`, so the wrapper would refuse the read here.
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
const SONG_AUDIOLESS_READY_ID = crypto.randomUUID();
const SONG_MISSING_EMBEDDING_ID = crypto.randomUUID();

// pgvector accepts a string literal of the form "[v1,v2,...]". Match the
// declared dimension on song_embedding (512).
const ZERO_VECTOR = `[${new Array(512).fill(0).join(",")}]`;

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
				id: SONG_AUDIOLESS_READY_ID,
				spotify_id: `sp-audioless-${SONG_AUDIOLESS_READY_ID}`,
				name: "Audio-less Ready Song",
				artists: ["Artist A"],
				artist_ids: ["art-1"],
				genres: ["rock"],
			},
			{
				id: SONG_MISSING_EMBEDDING_ID,
				spotify_id: `sp-noembed-${SONG_MISSING_EMBEDDING_ID}`,
				name: "Missing Embedding Song",
				artists: ["Artist B"],
				artist_ids: ["art-2"],
				genres: ["jazz"],
			},
		])
		.throwOnError();

	const likedAt = new Date().toISOString();
	await supabase
		.from("liked_song")
		.insert([
			{
				account_id: ACCOUNT_ID,
				song_id: SONG_AUDIOLESS_READY_ID,
				liked_at: likedAt,
			},
			{
				account_id: ACCOUNT_ID,
				song_id: SONG_MISSING_EMBEDDING_ID,
				liked_at: likedAt,
			},
		])
		.throwOnError();

	await supabase
		.from("account_song_unlock")
		.insert([
			{
				account_id: ACCOUNT_ID,
				song_id: SONG_AUDIOLESS_READY_ID,
				source: "free_auto",
			},
			{
				account_id: ACCOUNT_ID,
				song_id: SONG_MISSING_EMBEDDING_ID,
				source: "free_auto",
			},
		])
		.throwOnError();

	// Both songs get analysis. Audio-less ready song also gets an embedding.
	await supabase
		.from("song_analysis")
		.insert([
			{
				song_id: SONG_AUDIOLESS_READY_ID,
				analysis: { mood: ["test"] },
				model: "test-model",
			},
			{
				song_id: SONG_MISSING_EMBEDDING_ID,
				analysis: { mood: ["test"] },
				model: "test-model",
			},
		])
		.throwOnError();

	await supabase
		.from("song_embedding")
		.insert({
			song_id: SONG_AUDIOLESS_READY_ID,
			kind: "song_semantic",
			model: "test-embed-model",
			dims: 512,
			content_hash: `hash-${SONG_AUDIOLESS_READY_ID}`,
			embedding: ZERO_VECTOR,
		})
		.throwOnError();

	// Intentionally no song_audio_feature row inserted — audio is optional.
}

async function teardownFixtures() {
	if (!supabase) return;
	// account FK cascade wipes liked_song, account_billing, unlocks; song
	// FK cascade wipes song_analysis and song_embedding.
	await supabase.from("account").delete().eq("id", ACCOUNT_ID).throwOnError();
	await supabase
		.from("song")
		.delete()
		.in("id", [SONG_AUDIOLESS_READY_ID, SONG_MISSING_EMBEDDING_ID])
		.throwOnError();
}

describe.skipIf(!IS_LOCAL)(
	"select_entitled_data_enriched_liked_song_ids: audio optional",
	() => {
		beforeAll(setupFixtures);
		afterAll(teardownFixtures);

		it("returns entitled song with genres+analysis+embedding but no audio_features", async () => {
			if (!supabase) throw new Error("supabase client not initialised");

			const { data, error } = await supabase.rpc(
				"select_entitled_data_enriched_liked_song_ids",
				{ p_account_id: ACCOUNT_ID },
			);

			expect(error).toBeNull();
			const ids = (data ?? []).map((row) => row.song_id);
			expect(ids).toContain(SONG_AUDIOLESS_READY_ID);
		});

		it("excludes entitled song missing song_embedding", async () => {
			if (!supabase) throw new Error("supabase client not initialised");

			const { data, error } = await supabase.rpc(
				"select_entitled_data_enriched_liked_song_ids",
				{ p_account_id: ACCOUNT_ID },
			);

			expect(error).toBeNull();
			const ids = (data ?? []).map((row) => row.song_id);
			expect(ids).not.toContain(SONG_MISSING_EMBEDDING_ID);
		});
	},
);

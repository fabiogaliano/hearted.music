/**
 * The full entitled set is read through PostgREST, which caps each response at
 * max_rows (1000 locally, supabase/config.toml). Auto-skipped unless
 * SUPABASE_URL is the local stack.
 */

import { createClient } from "@supabase/supabase-js";
import { Result } from "better-result";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Database } from "@/lib/data/database.types";
import { readEntitledDataEnrichedSongIds } from "@/lib/domains/billing/queries";

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

const ACCOUNT_ID = crypto.randomUUID();
// One past the local max_rows, so a single-request read loses a song.
const SONG_COUNT = 1001;
const SONG_IDS = Array.from({ length: SONG_COUNT }, () => crypto.randomUUID());
// Cleanup by spotify_id prefix: 1001 ids would overflow an .in() URL.
const SONG_TAG = `entitled-pagination-${ACCOUNT_ID}`;
const ZERO_VECTOR = `[${new Array(512).fill(0).join(",")}]`;
const INSERT_CHUNK = 250;

async function inChunks<T>(
	rows: T[],
	insert: (chunk: T[]) => PromiseLike<unknown>,
): Promise<void> {
	for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
		await insert(rows.slice(i, i + INSERT_CHUNK));
	}
}

beforeAll(async () => {
	if (!IS_LOCAL) return;
	await db()
		.from("account")
		.insert({ id: ACCOUNT_ID, spotify_id: `test-${ACCOUNT_ID}` })
		.throwOnError();
	// Unlimited access entitles every liked song, so no per-song unlock rows.
	await db()
		.from("account_billing")
		.insert({
			account_id: ACCOUNT_ID,
			plan: "free",
			unlimited_access_source: "self_hosted",
			subscription_status: "none",
		})
		.throwOnError();
	await inChunks(
		SONG_IDS.map((id) => ({
			id,
			spotify_id: `${SONG_TAG}-${id}`,
			name: "Entitled Song",
			artists: ["Artist"],
			artist_ids: ["art-1"],
			genres: ["rock"],
		})),
		(chunk) => db().from("song").insert(chunk).throwOnError(),
	);
	const likedAt = new Date().toISOString();
	await inChunks(
		SONG_IDS.map((song_id) => ({
			account_id: ACCOUNT_ID,
			song_id,
			liked_at: likedAt,
		})),
		(chunk) => db().from("liked_song").insert(chunk).throwOnError(),
	);
	await inChunks(
		SONG_IDS.map((song_id) => ({
			song_id,
			analysis: { mood: ["test"] },
			model: "test-model",
		})),
		(chunk) => db().from("song_analysis").insert(chunk).throwOnError(),
	);
	await inChunks(
		SONG_IDS.map((song_id) => ({
			song_id,
			kind: "song_semantic" as const,
			model: "test-embed-model",
			dims: 512,
			content_hash: `hash-${song_id}`,
			embedding: ZERO_VECTOR,
		})),
		(chunk) => db().from("song_embedding").insert(chunk).throwOnError(),
	);
}, 120_000);

afterAll(async () => {
	if (!IS_LOCAL) return;
	await db().from("account").delete().eq("id", ACCOUNT_ID);
	await db().from("song").delete().like("spotify_id", `${SONG_TAG}-%`);
});

describeLocal("readEntitledDataEnrichedSongIds", () => {
	it("regression: returns every entitled song past the PostgREST row cap (a single read silently truncated at 1000)", async () => {
		const result = await readEntitledDataEnrichedSongIds(
			createAdminSupabaseClient(),
			ACCOUNT_ID,
		);
		if (Result.isError(result)) throw result.error;

		expect(result.value).toHaveLength(SONG_COUNT);
		expect(new Set(result.value)).toEqual(new Set(SONG_IDS));
	});
});

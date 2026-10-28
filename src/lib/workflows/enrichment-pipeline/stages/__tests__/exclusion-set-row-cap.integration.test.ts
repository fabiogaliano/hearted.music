/**
 * The match exclusion set is read through PostgREST, which caps each response
 * at max_rows (1000 locally, supabase/config.toml). Auto-skipped unless
 * SUPABASE_URL is the local stack.
 */

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/data/database.types";
import { loadExclusionSet } from "../matching";

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
const PLAYLIST_ID = crypto.randomUUID();
// One past the local max_rows, so a single-request read loses a pair.
const SONG_COUNT = 1001;
const SONG_IDS = Array.from({ length: SONG_COUNT }, () => crypto.randomUUID());
// Cleanup by spotify_id prefix: 1001 ids would overflow an .in() URL.
const SONG_TAG = `exclusion-row-cap-${ACCOUNT_ID}`;
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
	await db()
		.from("playlist")
		.insert({
			id: PLAYLIST_ID,
			account_id: ACCOUNT_ID,
			spotify_id: `${SONG_TAG}-playlist`,
			name: "Row Cap Playlist",
		})
		.throwOnError();
	await inChunks(
		SONG_IDS.map((id) => ({
			id,
			spotify_id: `${SONG_TAG}-${id}`,
			name: "Row Cap Song",
			artists: ["Artist"],
			artist_ids: ["art-1"],
		})),
		(chunk) => db().from("song").insert(chunk).throwOnError(),
	);
	await inChunks(
		SONG_IDS.map((song_id, position) => ({
			playlist_id: PLAYLIST_ID,
			song_id,
			position,
		})),
		(chunk) => db().from("playlist_song").insert(chunk).throwOnError(),
	);
}, 120_000);

afterAll(async () => {
	if (!IS_LOCAL) return;
	await db().from("account").delete().eq("id", ACCOUNT_ID);
	await db().from("song").delete().like("spotify_id", `${SONG_TAG}-%`);
});

describeLocal("loadExclusionSet", () => {
	it("regression: excludes every playlist member past the PostgREST row cap (a single read silently truncated at 1000, so members were stored as suggestions)", async () => {
		const exclusions = await loadExclusionSet(ACCOUNT_ID);

		expect(exclusions).toEqual(
			new Set(SONG_IDS.map((songId) => `${songId}:${PLAYLIST_ID}`)),
		);
	});
});

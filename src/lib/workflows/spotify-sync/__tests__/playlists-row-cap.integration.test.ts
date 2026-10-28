/**
 * The playlist sync diff reads the account's playlists through PostgREST,
 * which caps each response at max_rows (1000 locally, supabase/config.toml).
 * Auto-skipped unless SUPABASE_URL is the local stack.
 */

import { createClient } from "@supabase/supabase-js";
import { Result } from "better-result";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/data/database.types";
import { getPlaylists } from "@/lib/domains/library/playlists/queries";
import { toSpotifyPlaylistDTO } from "@/test/fixtures";
import { syncPlaylists } from "../playlist-sync";

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
// Two past the local max_rows: the last two by name fall past a single read.
const PLAYLIST_COUNT = 1002;
const INSERT_CHUNK = 250;

// Name order is array order, except rows 999 and 1000 share a name so the page
// boundary falls inside a duplicate. The last one is a target past the cut.
const PLAYLISTS = Array.from({ length: PLAYLIST_COUNT }, (_, i) => ({
	id: crypto.randomUUID(),
	account_id: ACCOUNT_ID,
	spotify_id: `row-cap-${ACCOUNT_ID}-${i}`,
	name: `Playlist ${String(i === 1000 ? 999 : i).padStart(4, "0")}`,
	description: null,
	song_count: 0,
	image_url: null,
	is_target: i === PLAYLIST_COUNT - 1,
}));
const TARGET = PLAYLISTS[PLAYLIST_COUNT - 1];

beforeAll(async () => {
	if (!IS_LOCAL) return;
	await db()
		.from("account")
		.insert({ id: ACCOUNT_ID, spotify_id: `test-${ACCOUNT_ID}` })
		.throwOnError();
	for (let i = 0; i < PLAYLISTS.length; i += INSERT_CHUNK) {
		await db()
			.from("playlist")
			.insert(PLAYLISTS.slice(i, i + INSERT_CHUNK))
			.throwOnError();
	}
}, 120_000);

afterAll(async () => {
	if (!IS_LOCAL) return;
	await db().from("account").delete().eq("id", ACCOUNT_ID);
});

describeLocal("playlist sync diff past the PostgREST row cap", () => {
	it("regression: getPlaylists returns every playlist once across a duplicate name at the page boundary (a single read silently truncated at 1000)", async () => {
		const result = await getPlaylists(ACCOUNT_ID);
		if (Result.isError(result)) throw result.error;

		const ids = result.value.map((p) => p.id);
		expect(ids).toHaveLength(PLAYLIST_COUNT);
		expect(new Set(ids)).toEqual(new Set(PLAYLISTS.map((p) => p.id)));
	});

	it("regression: a target playlist past row 1000 keeps is_target through a sync (it read as new and the upsert cleared the flag)", async () => {
		const synced = await syncPlaylists(
			ACCOUNT_ID,
			PLAYLISTS.map((p) => toSpotifyPlaylistDTO(p, "owner")),
		);
		if (Result.isError(synced)) throw synced.error;

		expect(synced.value.created).toBe(0);
		const { data } = await db()
			.from("playlist")
			.select("is_target")
			.eq("id", TARGET.id)
			.single()
			.throwOnError();
		expect(data.is_target).toBe(true);
	});
});

/**
 * The admin client's row-cap guard, against the real PostgREST cap (max_rows =
 * 1000 locally, supabase/config.toml). Auto-skipped unless SUPABASE_URL is the
 * local stack.
 */

import { createClient } from "@supabase/supabase-js";
import { Result } from "better-result";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Database } from "@/lib/data/database.types";
import { ROW_CAP_ERROR_CODE } from "@/lib/data/row-cap-guard";
import type { DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMany,
	readAllRows,
} from "@/lib/shared/utils/result-wrappers/supabase";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const IS_LOCAL =
	SUPABASE_URL.startsWith("http://127.0.0.1") &&
	SUPABASE_SERVICE_ROLE_KEY.length > 0;

// Seeding goes around the guard so a guard bug can't break the fixture.
const seedClient = IS_LOCAL
	? createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false },
		})
	: null;

function seed() {
	if (!seedClient) throw new Error("supabase client not initialised");
	return seedClient;
}

const describeLocal = IS_LOCAL ? describe : describe.skip;

const ACCOUNT_ID = crypto.randomUUID();
const PLAYLIST_ID = crypto.randomUUID();
// One past max_rows; positions 0..1000 let a filter pick 999 or 1000 of them.
const SONG_COUNT = 1001;
const SONG_IDS = Array.from({ length: SONG_COUNT }, () => crypto.randomUUID());
// Cleanup by spotify_id prefix: 1001 ids would overflow an .in() URL.
const SONG_TAG = `row-cap-guard-${ACCOUNT_ID}`;
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
	await seed()
		.from("account")
		.insert({ id: ACCOUNT_ID, spotify_id: `test-${ACCOUNT_ID}` })
		.throwOnError();
	await seed()
		.from("playlist")
		.insert({
			id: PLAYLIST_ID,
			account_id: ACCOUNT_ID,
			spotify_id: `${SONG_TAG}-playlist`,
			name: "Row Cap Guard Playlist",
		})
		.throwOnError();
	await inChunks(
		SONG_IDS.map((id) => ({
			id,
			spotify_id: `${SONG_TAG}-${id}`,
			name: "Row Cap Guard Song",
			artists: ["Artist"],
			artist_ids: ["art-1"],
		})),
		(chunk) => seed().from("song").insert(chunk).throwOnError(),
	);
	await inChunks(
		SONG_IDS.map((song_id, position) => ({
			playlist_id: PLAYLIST_ID,
			song_id,
			position,
		})),
		(chunk) => seed().from("playlist_song").insert(chunk).throwOnError(),
	);
}, 120_000);

afterAll(async () => {
	if (!IS_LOCAL) return;
	await seed().from("account").delete().eq("id", ACCOUNT_ID).throwOnError();
	await seed()
		.from("song")
		.delete()
		.like("spotify_id", `${SONG_TAG}-%`)
		.throwOnError();
});

function members() {
	return createAdminSupabaseClient()
		.from("playlist_song")
		.select("song_id")
		.eq("playlist_id", PLAYLIST_ID);
}

function expectRowCapError(result: Result<unknown, DbError>) {
	expect(result).toBeErr();
	if (Result.isError(result)) {
		expect(result.error).toMatchObject({ code: ROW_CAP_ERROR_CODE });
	}
}

describeLocal("admin client row-cap guard", () => {
	it("regression: an unpaged read of 1,001 rows fails instead of silently returning the first 1,000", async () => {
		expectRowCapError(await fromSupabaseMany(members()));
	});

	it("fails an unpaged read that fills max_rows exactly, but not one a row short", async () => {
		expectRowCapError(await fromSupabaseMany(members().lt("position", 1000)));
		const underCap = await fromSupabaseMany(members().lt("position", 999));
		expect(underCap.unwrap()).toHaveLength(999);
	});

	it("fails a limit past max_rows, which PostgREST would cut to 1,000", async () => {
		expectRowCapError(await fromSupabaseMany(members().limit(5000)));
	});

	it("fails a set-returning RPC that hits max_rows", async () => {
		const { error } = await createAdminSupabaseClient().rpc(
			"list_account_match_exclusion_pairs",
			{ p_account_id: ACCOUNT_ID },
		);

		expect(error).toMatchObject({ code: ROW_CAP_ERROR_CODE });
	});

	it("lets readAllRows page past max_rows", async () => {
		const rows = await readAllRows((from, to) =>
			fromSupabaseMany(members().order("position").range(from, to)),
		);

		expect(rows.unwrap()).toHaveLength(SONG_COUNT);
	});

	it("lets a count-only HEAD read through, though its Content-Range spans max_rows", async () => {
		const { count, error } = await createAdminSupabaseClient()
			.from("playlist_song")
			.select("*", { count: "exact", head: true })
			.eq("playlist_id", PLAYLIST_ID);

		expect(error).toBeNull();
		expect(count).toBe(SONG_COUNT);
	});

	it("lets a write return max_rows rows, since PostgREST doesn't cut write representations", async () => {
		const result = await fromSupabaseMany(
			createAdminSupabaseClient()
				.from("playlist_song")
				.update({ added_at: "2026-01-01T00:00:00Z" })
				.eq("playlist_id", PLAYLIST_ID)
				.lt("position", 1000)
				.select("song_id"),
		);

		expect(result.unwrap()).toHaveLength(1000);
	});
});

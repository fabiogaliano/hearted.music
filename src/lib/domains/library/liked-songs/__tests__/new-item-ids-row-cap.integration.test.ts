/**
 * New-item ids are read through PostgREST, which caps each response at
 * max_rows (1000 locally, supabase/config.toml). Seeds through postgres.js
 * against DATABASE_URL; auto-skipped unless that is the local stack.
 */

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getNewItemIds } from "../status-queries";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL =
	DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost");

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 2, fetch_types: false })
	: null;

function db() {
	if (!sql) throw new Error("postgres client not initialised");
	return sql;
}

const describeLocal = IS_LOCAL ? describe : describe.skip;

const ACCOUNT_ID = crypto.randomUUID();
// One past max_rows, so a single-request read loses a new song.
const NEW_SONG_COUNT = 1001;
const NEW_SONG_IDS = Array.from({ length: NEW_SONG_COUNT }, () =>
	crypto.randomUUID(),
);

beforeAll(async () => {
	if (!IS_LOCAL) return;
	const client = db();
	await client`INSERT INTO account(id, spotify_id) VALUES (${ACCOUNT_ID}, ${`test-${ACCOUNT_ID}`})`;
	// Already-seen rows must stay out of the result however they sort.
	await client`
		INSERT INTO account_item_newness(account_id, item_id, item_type, is_new)
		SELECT ${ACCOUNT_ID}::uuid, id::uuid, 'song'::item_type, true
		FROM unnest(${`{${NEW_SONG_IDS.join(",")}}`}::text[]) AS id
		UNION ALL
		SELECT ${ACCOUNT_ID}::uuid, gen_random_uuid(), 'song'::item_type, false
		FROM generate_series(1, 5)
	`;
}, 60_000);

afterAll(async () => {
	if (!sql) return;
	await sql`DELETE FROM account_item_newness WHERE account_id = ${ACCOUNT_ID}`;
	await sql`DELETE FROM account WHERE id = ${ACCOUNT_ID}`;
	await sql.end();
});

describeLocal("getNewItemIds", () => {
	it("regression: returns every new song past the PostgREST row cap (a single read stopped at 1000, so the rest lost their newness ordering)", async () => {
		const result = await getNewItemIds(ACCOUNT_ID, "song");

		expect(new Set(result.unwrap())).toEqual(new Set(NEW_SONG_IDS));
		expect(result.unwrap()).toHaveLength(NEW_SONG_COUNT);
	});
});

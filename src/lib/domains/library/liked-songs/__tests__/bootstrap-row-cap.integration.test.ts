/**
 * A deep link to a song past PostgREST's max_rows (1000 locally,
 * supabase/config.toml). The bootstrap used to return every liked song from the
 * newest down to the linked one, so a single read stopped at row 1000; it now
 * reads a window around the song, which must resolve however deep it sits.
 * Seeds through postgres.js against DATABASE_URL; auto-skipped unless that is
 * the local stack.
 */

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSongSlug } from "@/lib/domains/library/songs/slug";
import { LIKED_SONGS_DEEP_LINK_CONTEXT_ROWS } from "../constants";
import { getBootstrapPagesBySlug } from "../queries";

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
const ANCHOR_SONG_ID = crypto.randomUUID();
// Two past max_rows: the anchor is the oldest like, so it sits at row 1002.
const LIKED_COUNT = 1002;
const TAG = `bootstrap-row-cap-${ACCOUNT_ID}`;
const ANCHOR_ARTIST = "Row Cap Anchor Artist";
const ANCHOR_NAME = `Anchor ${ACCOUNT_ID}`;

beforeAll(async () => {
	if (!IS_LOCAL) return;
	const client = db();
	await client`INSERT INTO account(id, spotify_id) VALUES (${ACCOUNT_ID}, ${`test-${ACCOUNT_ID}`})`;
	await client`
		INSERT INTO account_billing(account_id, plan, subscription_status)
		VALUES (${ACCOUNT_ID}, 'free', 'none')
	`;
	await client`
		INSERT INTO song(id, spotify_id, name, artists, artist_ids)
		SELECT gen_random_uuid(), ${TAG} || '-' || n, 'Row Cap Song ' || n, '{Artist}'::text[], '{art-1}'::text[]
		FROM generate_series(1, ${LIKED_COUNT - 1}) AS n
	`;
	await client`
		INSERT INTO song(id, spotify_id, name, artists, artist_ids)
		VALUES (${ANCHOR_SONG_ID}, ${`${TAG}-anchor`}, ${ANCHOR_NAME}, ${`{"${ANCHOR_ARTIST}"}`}::text[], '{art-anchor}'::text[])
	`;
	// Newest first by suffix; the anchor is liked before all of them.
	await client`
		INSERT INTO liked_song(account_id, song_id, liked_at)
		SELECT ${ACCOUNT_ID}::uuid, s.id,
			CASE WHEN s.id = ${ANCHOR_SONG_ID}::uuid THEN '2020-01-01'::timestamptz
			ELSE '2026-01-01'::timestamptz - split_part(s.spotify_id, '-', -1)::int * interval '1 minute' END
		FROM song s WHERE s.spotify_id LIKE ${`${TAG}-%`}
	`;
}, 60_000);

afterAll(async () => {
	if (!sql) return;
	await sql`DELETE FROM account WHERE id = ${ACCOUNT_ID}`;
	await sql`DELETE FROM song WHERE spotify_id LIKE ${`${TAG}-%`}`;
	await sql.end();
});

describeLocal("getBootstrapPagesBySlug", () => {
	it("regression: selects a deep-linked song past the PostgREST row cap (a single read stopped at row 1000, so the link fell back to the first page with the panel closed)", async () => {
		const result = await getBootstrapPagesBySlug(
			ACCOUNT_ID,
			generateSongSlug(ANCHOR_ARTIST, ANCHOR_NAME),
		);

		const { selectedRow, pages, startCursor } = result.unwrap();
		expect(selectedRow?.song_id).toBe(ANCHOR_SONG_ID);
		// The anchor is the oldest like: the window is the context rows above it
		// and the anchor itself, with a cursor to load the rest above.
		const rows = pages.flatMap((page) => page.items);
		expect(rows).toHaveLength(LIKED_SONGS_DEEP_LINK_CONTEXT_ROWS + 1);
		expect(rows.at(-1)?.song_id).toBe(ANCHOR_SONG_ID);
		expect(startCursor).not.toBeNull();
		expect(pages.at(-1)?.nextCursor).toBeNull();
	});
});

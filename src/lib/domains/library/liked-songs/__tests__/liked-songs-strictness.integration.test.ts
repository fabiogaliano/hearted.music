/**
 * Live-DB integration tests for the read-time strictness bar (`p_min_score`)
 * on the liked-songs RPCs.
 *
 * Connects via postgres.js against DATABASE_URL (superuser, bypasses RLS).
 * Auto-skipped when DATABASE_URL is not the local stack, so CI environments
 * without a local Supabase are unaffected — same gating as the claim_handle
 * integration suite.
 *
 * Scenario: one entitled song whose best match is above the bar (0.9) and one
 * whose only match is below it (0.4). The bar must move that second song from
 * "has suggestions" to "no suggestions" without touching match_result.
 */

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL =
	DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost");

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 5, fetch_types: false })
	: null;

function db() {
	if (!sql) throw new Error("postgres client not initialised");
	return sql;
}

const describeLocal = IS_LOCAL ? describe : describe.skip;

const ACCOUNT = "00000000-0000-4000-8000-00000000a001";
const SONG_HI = "00000000-0000-4000-8000-00000000beef"; // best match 0.9
const SONG_LOW = "00000000-0000-4000-8000-00000000face"; // only match 0.4
const PLAYLIST = "00000000-0000-4000-8000-00000000c001";
const SNAPSHOT = "00000000-0000-4000-8000-00000000d001";

async function seed() {
	const client = db();
	await client`INSERT INTO account(id, spotify_id) VALUES (${ACCOUNT}, ${"sp-strictness"})`;

	for (const [id, name] of [
		[SONG_HI, "High Song"],
		[SONG_LOW, "Low Song"],
	] as const) {
		// fetch_types:false disables array-type inference, so bind Postgres array
		// literals and cast them explicitly.
		await client`
      INSERT INTO song(id, spotify_id, name, artists, artist_ids, genres)
      VALUES (${id}, ${`sp-${id}`}, ${name}, ${"{Artist}"}::text[], ${"{artist-1}"}::text[], ${"{pop}"}::text[])
    `;
		await client`INSERT INTO liked_song(account_id, song_id, liked_at) VALUES (${ACCOUNT}, ${id}, now())`;
		// Entitle the song so it counts toward has_suggestions / matching_status.
		await client`INSERT INTO account_song_unlock(account_id, song_id, source) VALUES (${ACCOUNT}, ${id}, ${"admin"})`;
	}

	await client`
    INSERT INTO playlist(id, account_id, spotify_id, name)
    VALUES (${PLAYLIST}, ${ACCOUNT}, ${"sp-pl-1"}, ${"Playlist One"})
  `;

	await client`
    INSERT INTO match_snapshot(id, account_id, algorithm_version, config_hash, playlist_set_hash, candidate_set_hash, snapshot_hash)
    VALUES (${SNAPSHOT}, ${ACCOUNT}, ${"v1"}, ${"c"}, ${"p"}, ${"cand"}, ${"snap"})
  `;

	await client`INSERT INTO match_result(snapshot_id, song_id, playlist_id, score) VALUES (${SNAPSHOT}, ${SONG_HI}, ${PLAYLIST}, ${0.9})`;
	await client`INSERT INTO match_result(snapshot_id, song_id, playlist_id, score) VALUES (${SNAPSHOT}, ${SONG_LOW}, ${PLAYLIST}, ${0.4})`;
}

async function cleanup() {
	if (!sql) return;
	// FKs cascade from snapshot/playlist/song, but be explicit and ordered.
	await sql`DELETE FROM match_result WHERE snapshot_id = ${SNAPSHOT}`;
	await sql`DELETE FROM match_snapshot WHERE id = ${SNAPSHOT}`;
	await sql`DELETE FROM playlist WHERE id = ${PLAYLIST}`;
	await sql`DELETE FROM account_song_unlock WHERE account_id = ${ACCOUNT}`;
	await sql`DELETE FROM liked_song WHERE account_id = ${ACCOUNT}`;
	await sql`DELETE FROM song WHERE id IN (${SONG_HI}, ${SONG_LOW})`;
	await sql`DELETE FROM account WHERE id = ${ACCOUNT}`;
}

beforeAll(async () => {
	if (!sql) return;
	await cleanup();
	await seed();
});

afterAll(async () => {
	if (!sql) return;
	await cleanup();
	await sql.end();
});

describeLocal("liked-songs RPCs honor p_min_score", () => {
	it("get_liked_songs_stats counts both songs at the floor, one above the strict bar", async () => {
		const open =
			await db()`SELECT has_suggestions FROM get_liked_songs_stats(${ACCOUNT}, ${0})`;
		expect(Number(open[0].has_suggestions)).toBe(2);

		const strict =
			await db()`SELECT has_suggestions FROM get_liked_songs_stats(${ACCOUNT}, ${0.65})`;
		expect(Number(strict[0].has_suggestions)).toBe(1);
	});

	it("get_liked_songs_page 'has_suggestions' filter drops the below-bar song", async () => {
		const open = await db()`
      SELECT song_id FROM get_liked_songs_page(${ACCOUNT}, NULL, 50, 'has_suggestions', NULL, NULL, ${0})
    `;
		expect(open.map((r) => r.song_id).sort()).toEqual(
			[SONG_HI, SONG_LOW].sort(),
		);

		const strict = await db()`
      SELECT song_id FROM get_liked_songs_page(${ACCOUNT}, NULL, 50, 'has_suggestions', NULL, NULL, ${0.65})
    `;
		expect(strict.map((r) => r.song_id)).toEqual([SONG_HI]);
	});

	it("get_liked_songs_page matching_status reflects the bar for the unfiltered view", async () => {
		const rows = await db()`
      SELECT song_id, matching_status FROM get_liked_songs_page(${ACCOUNT}, NULL, 50, 'all', NULL, NULL, ${0.65})
    `;
		const byId = new Map(rows.map((r) => [r.song_id, r.matching_status]));
		expect(byId.get(SONG_HI)).toBe("has_suggestions");
		// The below-bar song now reads as no_suggestions (entitled, has matches
		// stored, but none visible) — never has_suggestions.
		expect(byId.get(SONG_LOW)).not.toBe("has_suggestions");
	});
});

/**
 * Live-DB integration tests pinning the playlist-membership exclusion invariant
 * across the three layers that must all agree on it:
 *
 *   1. get_match_pairs_for_song / get_match_pairs_for_playlist — the candidate
 *      pair read used by every suggestion caller (matcher, capture, decks). The
 *      anti-join against playlist_song (migration 20260708000025) is the primary
 *      guarantee: a pair whose song is already in the playlist never leaves the DB.
 *   2. read_match_deck_card — the first-page deck read (migration 20260708000022).
 *   3. read_match_review_item_song_suggestions — the keyset tail-page read
 *      (migration 20260708000023).
 *
 * Layers 2/3 are the read-time safety net for stale captures and races: even if a
 * membership change lands after visible pairs were captured, the card must still
 * hide a song already in the playlist. These only get exercised against real SQL,
 * so the plpgsql NOT EXISTS predicates are pinned here rather than mocked.
 *
 * Connects via postgres.js against DATABASE_URL (superuser, bypasses RLS).
 * Auto-skipped when DATABASE_URL is not the local stack — same gating as
 * match-event-log.integration.test.ts, whose harness this mirrors.
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

const ACCOUNT = "00000000-0000-4000-8000-0000000d1000";
const SNAPSHOT = "00000000-0000-4000-8000-0000000d10d1";
const SESSION = "00000000-0000-4000-8000-0000000d15e1";

// Test A (pair-read, song orientation): song -> A (member) and song -> B (fresh).
const PLAYLIST_A = "00000000-0000-4000-8000-0000000d10a1";
const PLAYLIST_B = "00000000-0000-4000-8000-0000000d10b1";
const SONG_A = "00000000-0000-4000-8000-0000000d1501";

// Test B (pair-read, playlist orientation): member song + fresh song -> one playlist.
const PLAYLIST_PAIR = "00000000-0000-4000-8000-0000000d10c1";
const SONG_B_MEMBER = "00000000-0000-4000-8000-0000000d1502";
const SONG_B_FRESH = "00000000-0000-4000-8000-0000000d1503";

// Test C/E (playlist-orientation captured card): member + fresh suggestion songs.
const PLAYLIST_SUBJ = "00000000-0000-4000-8000-0000000d10d2";
const SONG_C_MEMBER = "00000000-0000-4000-8000-0000000d1504";
const SONG_C_FRESH = "00000000-0000-4000-8000-0000000d1505";
const ITEM_PLAYLIST = "00000000-0000-4000-8000-0000000d1401";

// Test D (song-orientation captured card): subject song already in one suggestion
// playlist, absent from the other.
const PLAYLIST_D_MEMBER = "00000000-0000-4000-8000-0000000d10e1";
const PLAYLIST_D_FRESH = "00000000-0000-4000-8000-0000000d10f1";
const SONG_D = "00000000-0000-4000-8000-0000000d1506";
const ITEM_SONG = "00000000-0000-4000-8000-0000000d1402";

const ALL_SONGS = [
	SONG_A,
	SONG_B_MEMBER,
	SONG_B_FRESH,
	SONG_C_MEMBER,
	SONG_C_FRESH,
	SONG_D,
] as const;

const ALL_PLAYLISTS = [
	[PLAYLIST_A, "Playlist A"],
	[PLAYLIST_B, "Playlist B"],
	[PLAYLIST_PAIR, "Pair Subject"],
	[PLAYLIST_SUBJ, "Card Subject"],
	[PLAYLIST_D_MEMBER, "Song Card Member"],
	[PLAYLIST_D_FRESH, "Song Card Fresh"],
] as const;

async function seed() {
	const client = db();
	await client`INSERT INTO account(id, spotify_id) VALUES (${ACCOUNT}, ${"sp-match-pairs"})`;

	for (const id of ALL_SONGS) {
		// fetch_types:false disables array-type inference, so bind Postgres array
		// literals and cast them explicitly (mirrors match-event-log.integration).
		await client`
      INSERT INTO song(id, spotify_id, name, artists, artist_ids, genres)
      VALUES (${id}, ${`sp-${id}`}, ${"Song"}, ${"{Artist}"}::text[], ${"{artist-1}"}::text[], ${"{pop}"}::text[])
    `;
	}

	for (const [id, name] of ALL_PLAYLISTS) {
		await client`
      INSERT INTO playlist(id, account_id, spotify_id, name)
      VALUES (${id}, ${ACCOUNT}, ${`sp-pl-${id}`}, ${name})
    `;
	}

	await client`
    INSERT INTO match_snapshot(id, account_id, algorithm_version, config_hash, playlist_set_hash, candidate_set_hash, snapshot_hash)
    VALUES (${SNAPSHOT}, ${ACCOUNT}, ${"v1"}, ${"c"}, ${"p"}, ${"cand"}, ${"snap"})
  `;

	await client`
    INSERT INTO match_review_session(id, account_id, status, strictness_preset, strictness_min_score)
    VALUES (${SESSION}, ${ACCOUNT}, ${"active"}, ${"balanced"}, ${0.5})
  `;

	// --- Test A: song -> A (score 0.9), song -> B (score 0.8). A is a member pair.
	await client`INSERT INTO match_result(snapshot_id, song_id, playlist_id, score, rank) VALUES (${SNAPSHOT}, ${SONG_A}, ${PLAYLIST_A}, ${0.9}, ${1})`;
	await client`INSERT INTO match_result(snapshot_id, song_id, playlist_id, score, rank) VALUES (${SNAPSHOT}, ${SONG_A}, ${PLAYLIST_B}, ${0.8}, ${2})`;
	await client`INSERT INTO playlist_song(playlist_id, song_id, position) VALUES (${PLAYLIST_A}, ${SONG_A}, ${0})`;

	// --- Test B: member + fresh song -> PLAYLIST_PAIR. Member song is in the playlist.
	await client`INSERT INTO match_result(snapshot_id, song_id, playlist_id, score, rank) VALUES (${SNAPSHOT}, ${SONG_B_MEMBER}, ${PLAYLIST_PAIR}, ${0.9}, ${1})`;
	await client`INSERT INTO match_result(snapshot_id, song_id, playlist_id, score, rank) VALUES (${SNAPSHOT}, ${SONG_B_FRESH}, ${PLAYLIST_PAIR}, ${0.8}, ${2})`;
	await client`INSERT INTO playlist_song(playlist_id, song_id, position) VALUES (${PLAYLIST_PAIR}, ${SONG_B_MEMBER}, ${0})`;

	// --- Test C/E: playlist-orientation captured item; suggestion songs = member + fresh.
	await client`
    INSERT INTO match_review_queue_item(id, session_id, account_id, orientation, playlist_id, source_snapshot_id, position, state, visible_pairs_captured_at)
    VALUES (${ITEM_PLAYLIST}, ${SESSION}, ${ACCOUNT}, ${"playlist"}, ${PLAYLIST_SUBJ}, ${SNAPSHOT}, ${0}, ${"active"}, now())
  `;
	for (const [songId, modelRank, visibleRank, fit] of [
		[SONG_C_MEMBER, 1, 1, 0.9],
		[SONG_C_FRESH, 2, 2, 0.8],
	] as const) {
		await client`
      INSERT INTO match_review_item_visible_pair(
        queue_item_id, song_id, playlist_id, session_id, account_id,
        snapshot_id, orientation, model_rank, visible_rank, fit_score
      ) VALUES (
        ${ITEM_PLAYLIST}, ${songId}, ${PLAYLIST_SUBJ}, ${SESSION}, ${ACCOUNT},
        ${SNAPSHOT}, ${"playlist"}, ${modelRank}, ${visibleRank}, ${fit}
      )
    `;
	}
	await client`INSERT INTO playlist_song(playlist_id, song_id, position) VALUES (${PLAYLIST_SUBJ}, ${SONG_C_MEMBER}, ${0})`;

	// --- Test D: song-orientation captured item; suggestion playlists = member + fresh.
	await client`
    INSERT INTO match_review_queue_item(id, session_id, account_id, orientation, song_id, source_snapshot_id, position, state, visible_pairs_captured_at)
    VALUES (${ITEM_SONG}, ${SESSION}, ${ACCOUNT}, ${"song"}, ${SONG_D}, ${SNAPSHOT}, ${1}, ${"active"}, now())
  `;
	for (const [playlistId, modelRank, visibleRank, fit] of [
		[PLAYLIST_D_MEMBER, 1, 1, 0.9],
		[PLAYLIST_D_FRESH, 2, 2, 0.8],
	] as const) {
		await client`
      INSERT INTO match_review_item_visible_pair(
        queue_item_id, song_id, playlist_id, session_id, account_id,
        snapshot_id, orientation, model_rank, visible_rank, fit_score
      ) VALUES (
        ${ITEM_SONG}, ${SONG_D}, ${playlistId}, ${SESSION}, ${ACCOUNT},
        ${SNAPSHOT}, ${"song"}, ${modelRank}, ${visibleRank}, ${fit}
      )
    `;
	}
	await client`INSERT INTO playlist_song(playlist_id, song_id, position) VALUES (${PLAYLIST_D_MEMBER}, ${SONG_D}, ${0})`;
}

async function cleanup() {
	if (!sql) return;
	// Ordered explicit deletes; FKs would cascade but be deterministic.
	await sql`DELETE FROM match_review_item_visible_pair WHERE account_id = ${ACCOUNT}`;
	await sql`DELETE FROM match_result WHERE snapshot_id = ${SNAPSHOT}`;
	// Delete playlist_song by both keys: every fixture row is covered by song_id
	// alone, but scoping playlist_id too keeps cleanup correct if a later fixture
	// adds a member row whose song lives outside ALL_SONGS.
	await sql`DELETE FROM playlist_song WHERE song_id IN ${sql(ALL_SONGS)}
    OR playlist_id IN ${sql(ALL_PLAYLISTS.map(([id]) => id))}`;
	await sql`DELETE FROM match_review_queue_item WHERE account_id = ${ACCOUNT}`;
	await sql`DELETE FROM match_review_session WHERE account_id = ${ACCOUNT}`;
	await sql`DELETE FROM match_snapshot WHERE id = ${SNAPSHOT}`;
	await sql`DELETE FROM playlist WHERE account_id = ${ACCOUNT}`;
	await sql`DELETE FROM song WHERE id IN ${sql(ALL_SONGS)}`;
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

describeLocal(
	"get_match_pairs_for_song excludes existing playlist members",
	() => {
		it("drops the playlist the song already belongs to, keeps the fresh one", async () => {
			const rows = await db()`
      SELECT * FROM public.get_match_pairs_for_song(${SNAPSHOT}, ${SONG_A})
    `;
			// PLAYLIST_A already contains the song → anti-joined out; only B survives.
			expect(rows.map((r) => r.playlist_id)).toEqual([PLAYLIST_B]);
			expect(rows.map((r) => r.playlist_id)).not.toContain(PLAYLIST_A);
		});
	},
);

describeLocal(
	"get_match_pairs_for_playlist excludes songs already in the playlist",
	() => {
		it("drops the member song, keeps the fresh song", async () => {
			const rows = await db()`
      SELECT * FROM public.get_match_pairs_for_playlist(${SNAPSHOT}, ${PLAYLIST_PAIR})
    `;
			// SONG_B_MEMBER is already in PLAYLIST_PAIR → excluded; SONG_B_FRESH stays.
			expect(rows.map((r) => r.song_id)).toEqual([SONG_B_FRESH]);
			expect(rows.map((r) => r.song_id)).not.toContain(SONG_B_MEMBER);
		});
	},
);

describeLocal(
	"read_match_deck_card hides songs already in the playlist",
	() => {
		it("playlist card: suggestion song already in the subject playlist is dropped", async () => {
			const [{ card }] = await db()`
      SELECT public.read_match_deck_card(${ITEM_PLAYLIST}, ${ACCOUNT}, ${100}, false) AS card
    `;
			expect(card.status).toBe("ready");
			const songIds = (card.suggestions as Array<{ song_id: string }>).map(
				(s) => s.song_id,
			);
			expect(songIds).toEqual([SONG_C_FRESH]);
			expect(songIds).not.toContain(SONG_C_MEMBER);
			expect(card.total_active_count).toBe(1);
		});

		it("song card: suggestion playlist that already contains the song is dropped", async () => {
			const [{ card }] = await db()`
      SELECT public.read_match_deck_card(${ITEM_SONG}, ${ACCOUNT}, ${100}, false) AS card
    `;
			expect(card.status).toBe("ready");
			const playlistIds = (
				card.suggestions as Array<{ playlist_id: string }>
			).map((s) => s.playlist_id);
			expect(playlistIds).toEqual([PLAYLIST_D_FRESH]);
			expect(playlistIds).not.toContain(PLAYLIST_D_MEMBER);
			expect(card.total_active_count).toBe(1);
		});
	},
);

describeLocal(
	"read_match_review_item_song_suggestions hides playlist members on the tail page",
	() => {
		it("returns only the fresh song and counts it once", async () => {
			const rows = await db()`
      SELECT * FROM public.read_match_review_item_song_suggestions(
        ${ITEM_PLAYLIST}, ${ACCOUNT}, ${100}, NULL::double precision, NULL::integer, NULL::uuid
      )
    `;
			expect(rows.map((r) => r.song_id)).toEqual([SONG_C_FRESH]);
			expect(rows.map((r) => r.song_id)).not.toContain(SONG_C_MEMBER);
			// total_active_count is a BIGINT window count — must equal the surviving
			// row count so the first page and the "N suggestions" total agree.
			expect(Number(rows[0].total_active_count)).toBe(1);
		});
	},
);

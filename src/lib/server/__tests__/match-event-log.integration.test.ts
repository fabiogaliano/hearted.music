/**
 * Live-DB integration tests for the /match queue decision RPCs and the
 * match_event interaction log they write (migration 20260617150000).
 *
 * Connects via postgres.js against DATABASE_URL (superuser, bypasses RLS).
 * Auto-skipped when DATABASE_URL is not the local stack, so CI environments
 * without a local Supabase are unaffected — same gating as the strictness suite.
 *
 * The unit suite (match-review-queue.functions.test.ts) mocks the Supabase
 * client wholesale, so it can't exercise any of the SQL these RPCs run: the
 * decision+event dual-write, the skip derivation in finish, and the NOT EXISTS
 * guard that keeps an added playlist from also being logged as skipped. Those
 * plpgsql branches are exactly what silently rots, so they're pinned here.
 *
 * match_decision models CURRENT STATE (added/dismissed only, feeds exclusion);
 * match_event models EVENT HISTORY (added/dismissed/skipped, never excludes).
 * Each scenario asserts both sides so the two layers can't drift.
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

const ACCOUNT = "00000000-0000-4000-8000-0000000ce000";
const SNAPSHOT = "00000000-0000-4000-8000-0000000ce0d1";
const SESSION = "00000000-0000-4000-8000-0000000ce5e1";
const PLAYLIST_A = "00000000-0000-4000-8000-0000000ce0a1";
const PLAYLIST_B = "00000000-0000-4000-8000-0000000ce0b1";

// One song + one queue item per scenario, so the (session, song) and
// (session, position) unique constraints never collide and no test bleeds into
// another's state.
const SONG_ADD = "00000000-0000-4000-8000-0000000ce501";
const ITEM_ADD = "00000000-0000-4000-8000-0000000ce401";
const SONG_DIS = "00000000-0000-4000-8000-0000000ce502";
const ITEM_DIS = "00000000-0000-4000-8000-0000000ce402";
const SONG_SKIP = "00000000-0000-4000-8000-0000000ce503";
const ITEM_SKIP = "00000000-0000-4000-8000-0000000ce403";
const SONG_MIX = "00000000-0000-4000-8000-0000000ce504";
const ITEM_MIX = "00000000-0000-4000-8000-0000000ce404";
const SONG_AGUARD = "00000000-0000-4000-8000-0000000ce505";
const ITEM_AGUARD = "00000000-0000-4000-8000-0000000ce405";

const STRICTNESS = 0.5;
const ALL_SONGS = [
	SONG_ADD,
	SONG_DIS,
	SONG_SKIP,
	SONG_MIX,
	SONG_AGUARD,
] as const;
const ALL_ITEMS = [
	[ITEM_ADD, SONG_ADD],
	[ITEM_DIS, SONG_DIS],
	[ITEM_SKIP, SONG_SKIP],
	[ITEM_MIX, SONG_MIX],
	[ITEM_AGUARD, SONG_AGUARD],
] as const;

async function seed() {
	const client = db();
	await client`INSERT INTO account(id, spotify_id) VALUES (${ACCOUNT}, ${"sp-match-event"})`;

	for (const id of ALL_SONGS) {
		// fetch_types:false disables array-type inference, so bind Postgres array
		// literals and cast them explicitly.
		await client`
      INSERT INTO song(id, spotify_id, name, artists, artist_ids, genres)
      VALUES (${id}, ${`sp-${id}`}, ${"Song"}, ${"{Artist}"}::text[], ${"{artist-1}"}::text[], ${"{pop}"}::text[])
    `;
		// Entitle every song — the add RPC rejects un-entitled songs.
		await client`INSERT INTO account_song_unlock(account_id, song_id, source) VALUES (${ACCOUNT}, ${id}, ${"admin"})`;
	}

	for (const [id, name] of [
		[PLAYLIST_A, "Playlist A"],
		[PLAYLIST_B, "Playlist B"],
	] as const) {
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
    VALUES (${SESSION}, ${ACCOUNT}, ${"active"}, ${"balanced"}, ${STRICTNESS})
  `;

	let position = 0;
	for (const [itemId, songId] of ALL_ITEMS) {
		await client`
      INSERT INTO match_review_queue_item(id, session_id, account_id, song_id, source_snapshot_id, position, state)
      VALUES (${itemId}, ${SESSION}, ${ACCOUNT}, ${songId}, ${SNAPSHOT}, ${position}, ${"active"})
    `;
		position += 1;
	}

	// Visible matches (score >= strictness). rank is the model/snapshot rank the
	// RPCs persist as model_rank.
	const visible: Array<[string, string, number, number]> = [
		[SONG_ADD, PLAYLIST_A, 0.9, 1],
		[SONG_DIS, PLAYLIST_A, 0.9, 1],
		[SONG_SKIP, PLAYLIST_A, 0.9, 1],
		[SONG_MIX, PLAYLIST_A, 0.9, 1],
		[SONG_MIX, PLAYLIST_B, 0.8, 2],
		[SONG_AGUARD, PLAYLIST_A, 0.9, 1],
	];
	for (const [songId, playlistId, score, rank] of visible) {
		await client`
      INSERT INTO match_result(snapshot_id, song_id, playlist_id, score, rank)
      VALUES (${SNAPSHOT}, ${songId}, ${playlistId}, ${score}, ${rank})
    `;
	}

	// Captured visible pairs (MSR-27/28). The add RPC (MSR-26), dismiss RPC (MSR-27),
	// and finish RPC (MSR-28) all read from match_review_item_visible_pair as the
	// source of ranks, so these rows must exist before any RPC call can succeed.
	// ITEM_SKIP is included because MSR-28 added a no_captured_pairs guard to finish.
	const capturedPairs: Array<[string, string, string, number, number]> = [
		[ITEM_ADD, SONG_ADD, PLAYLIST_A, 1, 1],
		[ITEM_DIS, SONG_DIS, PLAYLIST_A, 1, 1],
		[ITEM_SKIP, SONG_SKIP, PLAYLIST_A, 1, 1],
		[ITEM_MIX, SONG_MIX, PLAYLIST_A, 1, 1],
		[ITEM_MIX, SONG_MIX, PLAYLIST_B, 2, 2],
		[ITEM_AGUARD, SONG_AGUARD, PLAYLIST_A, 1, 1],
	];
	for (const [
		itemId,
		songId,
		playlistId,
		modelRank,
		visibleRank,
	] of capturedPairs) {
		await client`
      INSERT INTO match_review_item_visible_pair(
        queue_item_id, song_id, playlist_id, session_id, account_id,
        snapshot_id, orientation, model_rank, visible_rank, fit_score
      ) VALUES (
        ${itemId}, ${songId}, ${playlistId}, ${SESSION}, ${ACCOUNT},
        ${SNAPSHOT}, ${"song"}, ${modelRank}, ${visibleRank}, ${0.9}
      )
    `;
	}
}

async function cleanup() {
	if (!sql) return;
	// Ordered explicit deletes; FKs would cascade but be deterministic.
	await sql`DELETE FROM match_event WHERE account_id = ${ACCOUNT}`;
	await sql`DELETE FROM match_decision WHERE account_id = ${ACCOUNT}`;
	// match_review_item_visible_pair cascades on queue_item delete but is listed
	// explicitly here to keep the delete order clear and avoid FK ordering issues.
	await sql`DELETE FROM match_review_item_visible_pair WHERE account_id = ${ACCOUNT}`;
	await sql`DELETE FROM match_result WHERE snapshot_id = ${SNAPSHOT}`;
	await sql`DELETE FROM match_review_queue_item WHERE account_id = ${ACCOUNT}`;
	await sql`DELETE FROM match_review_session WHERE account_id = ${ACCOUNT}`;
	await sql`DELETE FROM match_snapshot WHERE id = ${SNAPSHOT}`;
	await sql`DELETE FROM playlist WHERE account_id = ${ACCOUNT}`;
	await sql`DELETE FROM account_song_unlock WHERE account_id = ${ACCOUNT}`;
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

describeLocal("match queue RPCs write to match_event", () => {
	it("add writes both a match_decision and an 'added' match_event", async () => {
		// MSR-26: add RPC now reads ranks from captured visible pairs; the caller
		// passes NULL for p_suggestion_song_id (song items) and the target playlist.
		const result =
			await db()`SELECT add_match_review_item_decision_atomic(${ITEM_ADD}, ${ACCOUNT}, NULL::uuid, ${PLAYLIST_A}) AS r`;
		expect(result[0].r).toBe("added");

		const decisions = await db()`
      SELECT decision FROM match_decision
      WHERE account_id = ${ACCOUNT} AND song_id = ${SONG_ADD} AND playlist_id = ${PLAYLIST_A}
    `;
		expect(decisions.map((d) => d.decision)).toEqual(["added"]);

		const events = await db()`
      SELECT event, model_rank, visible_rank, queue_item_id, session_id FROM match_event
      WHERE account_id = ${ACCOUNT} AND song_id = ${SONG_ADD}
    `;
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe("added");
		// model_rank and visible_rank come from the captured visible pair row.
		expect(events[0].model_rank).toBe(1);
		expect(events[0].visible_rank).toBe(1);
		expect(events[0].queue_item_id).toBe(ITEM_ADD);
		expect(events[0].session_id).toBe(SESSION);
	});

	it("dismiss does not overwrite or dismiss an already-added playlist", async () => {
		// The user adds A via the add RPC, then dismiss runs for the same item.
		// The NOT EXISTS guard in the dismiss RPC must skip A so it is never written
		// as 'dismissed' — keeping the decision 'added' and the event log clean.
		const added =
			await db()`SELECT add_match_review_item_decision_atomic(${ITEM_AGUARD}, ${ACCOUNT}, NULL::uuid, ${PLAYLIST_A}) AS r`;
		expect(added[0].r).toBe("added");

		// MSR-27: no p_decisions JSONB — the RPC reads from captured visible pairs.
		const dismissed =
			await db()`SELECT dismiss_match_review_item_atomic(${ITEM_AGUARD}, ${ACCOUNT}) AS r`;
		expect(dismissed[0].r).toBe("dismissed");

		// Decision stays 'added' — the add won; the dismissed ON CONFLICT DO UPDATE
		// is suppressed by the NOT EXISTS guard for pairs already added.
		const decisions = await db()`
      SELECT decision FROM match_decision
      WHERE account_id = ${ACCOUNT} AND song_id = ${SONG_AGUARD} AND playlist_id = ${PLAYLIST_A}
    `;
		expect(decisions.map((d) => d.decision)).toEqual(["added"]);

		// Exactly one event for A, and it's the 'added' one — no 'dismissed'.
		const events = await db()`
      SELECT event FROM match_event
      WHERE account_id = ${ACCOUNT} AND song_id = ${SONG_AGUARD} AND playlist_id = ${PLAYLIST_A}
    `;
		expect(events.map((e) => e.event)).toEqual(["added"]);
	});

	it("dismiss writes a 'dismissed' decision and a 'dismissed' event", async () => {
		// MSR-27: no p_decisions JSONB — the RPC derives decisions from captured
		// visible pairs in match_review_item_visible_pair (seeded in beforeAll).
		const result =
			await db()`SELECT dismiss_match_review_item_atomic(${ITEM_DIS}, ${ACCOUNT}) AS r`;
		expect(result[0].r).toBe("dismissed");

		const decisions = await db()`
      SELECT decision, model_rank, visible_rank, served_orientation FROM match_decision
      WHERE account_id = ${ACCOUNT} AND song_id = ${SONG_DIS} AND playlist_id = ${PLAYLIST_A}
    `;
		expect(decisions.map((d) => d.decision)).toEqual(["dismissed"]);
		// Ranks come from the captured pair rows — never recomputed at dismiss time.
		expect(decisions[0].model_rank).toBe(1);
		expect(decisions[0].visible_rank).toBe(1);
		expect(decisions[0].served_orientation).toBe("song");

		const events = await db()`
      SELECT event, model_rank, visible_rank, served_orientation FROM match_event
      WHERE account_id = ${ACCOUNT} AND song_id = ${SONG_DIS} AND playlist_id = ${PLAYLIST_A}
    `;
		expect(events.map((e) => e.event)).toEqual(["dismissed"]);
		expect(events[0].model_rank).toBe(1);
		expect(events[0].visible_rank).toBe(1);
		expect(events[0].served_orientation).toBe("song");
	});

	it("finish logs a 'skipped' event but never a match_decision", async () => {
		const result =
			await db()`SELECT finish_match_review_item_atomic(${ITEM_SKIP}, ${ACCOUNT}) AS r`;
		// No adds on this card → the item resolves as skipped.
		expect(result[0].r).toBe("skipped");

		const events = await db()`
      SELECT event, model_rank, visible_rank FROM match_event
      WHERE account_id = ${ACCOUNT} AND song_id = ${SONG_SKIP} AND playlist_id = ${PLAYLIST_A}
    `;
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe("skipped");
		// Ranks come from the captured pair rows (MSR-28) — never recomputed at
		// finish time so the logged position matches exactly what the user saw.
		expect(events[0].model_rank).toBe(1);
		expect(events[0].visible_rank).toBe(1);

		// match_decision must hold nothing for a skip — its CHECK only allows
		// added/dismissed, and the exclusion set is built from it.
		const decisions = await db()`
      SELECT 1 FROM match_decision
      WHERE account_id = ${ACCOUNT} AND song_id = ${SONG_SKIP}
    `;
		expect(decisions).toHaveLength(0);
	});

	it("a skip does not enter the exclusion source (match_decision)", async () => {
		// The matcher's exclusion set is derived from match_decision, which the
		// previous finish left empty for SONG_SKIP. A skipped pair can therefore
		// resurface in a later snapshot — the event log alone never excludes.
		const decisions = await db()`
      SELECT 1 FROM match_decision
      WHERE account_id = ${ACCOUNT} AND song_id = ${SONG_SKIP} AND playlist_id = ${PLAYLIST_A}
    `;
		expect(decisions).toHaveLength(0);

		// And the skip IS recorded in the event log (so it's a usable signal,
		// just not an exclusion).
		const events = await db()`
      SELECT event FROM match_event
      WHERE account_id = ${ACCOUNT} AND song_id = ${SONG_SKIP} AND event = ${"skipped"}
    `;
		expect(events).toHaveLength(1);
	});

	it("an added playlist is not also logged as skipped when the card finishes", async () => {
		// Card with two visible playlists; the user adds A, leaves B.
		// MSR-26: add RPC now reads ranks from captured visible pairs.
		const added =
			await db()`SELECT add_match_review_item_decision_atomic(${ITEM_MIX}, ${ACCOUNT}, NULL::uuid, ${PLAYLIST_A}) AS r`;
		expect(added[0].r).toBe("added");

		const finished =
			await db()`SELECT finish_match_review_item_atomic(${ITEM_MIX}, ${ACCOUNT}) AS r`;
		// An add happened → the card resolves as added, not skipped.
		expect(finished[0].r).toBe("completed_added");

		const events = await db()`
      SELECT playlist_id, event FROM match_event
      WHERE account_id = ${ACCOUNT} AND song_id = ${SONG_MIX}
      ORDER BY playlist_id
    `;
		const byPlaylist = new Map(events.map((e) => [e.playlist_id, e.event]));
		// A was added — exactly one 'added' event, never a 'skipped' one.
		expect(byPlaylist.get(PLAYLIST_A)).toBe("added");
		expect(
			events.filter(
				(e) => e.playlist_id === PLAYLIST_A && e.event === "skipped",
			),
		).toHaveLength(0);
		// B was visible and untouched — logged as skipped.
		expect(byPlaylist.get(PLAYLIST_B)).toBe("skipped");
	});
});

// ----------------------------------------------------------------------------
// publish_match_snapshot → match_snapshot_playlist_profile (migration 160000)
// ----------------------------------------------------------------------------

const PROF_ACCOUNT = "00000000-0000-4000-8000-0000000cf000";
const PROF_PLAYLIST = "00000000-0000-4000-8000-0000000cf0a1";
const PROF_SONG = "00000000-0000-4000-8000-0000000cf501";
const PROF_OLD = "00000000-0000-4000-8000-0000000cf0e1"; // older profile row
const PROF_NEW = "00000000-0000-4000-8000-0000000cf0e2"; // newer profile row

async function seedProfileFixture() {
	const client = db();
	await client`INSERT INTO account(id, spotify_id) VALUES (${PROF_ACCOUNT}, ${"sp-prof-capture"})`;
	await client`
    INSERT INTO song(id, spotify_id, name, artists, artist_ids, genres)
    VALUES (${PROF_SONG}, ${"sp-prof-song"}, ${"Song"}, ${"{Artist}"}::text[], ${"{artist-1}"}::text[], ${"{pop}"}::text[])
  `;
	await client`
    INSERT INTO playlist(id, account_id, spotify_id, name)
    VALUES (${PROF_PLAYLIST}, ${PROF_ACCOUNT}, ${"sp-prof-pl"}, ${"Profiled Playlist"})
  `;

	// Two profile rows for the same playlist. They differ only by content_hash
	// (the unique key is playlist_id+kind+model_bundle_hash+content_hash), and
	// PROF_NEW has the strictly newer updated_at — the row publish_match_snapshot
	// must pick via ORDER BY updated_at DESC.
	await client`
    INSERT INTO playlist_profile(id, playlist_id, kind, model_bundle_hash, dims, content_hash, updated_at)
    VALUES (${PROF_OLD}, ${PROF_PLAYLIST}, ${"intent"}, ${"mb-1"}, ${1}, ${"hash-old"}, ${"2026-01-01T00:00:00Z"})
  `;
	await client`
    INSERT INTO playlist_profile(id, playlist_id, kind, model_bundle_hash, dims, content_hash, updated_at)
    VALUES (${PROF_NEW}, ${PROF_PLAYLIST}, ${"intent"}, ${"mb-1"}, ${1}, ${"hash-new"}, ${"2026-02-01T00:00:00Z"})
  `;
}

async function cleanupProfileFixture() {
	if (!sql) return;
	await sql`DELETE FROM match_snapshot WHERE account_id = ${PROF_ACCOUNT}`;
	await sql`DELETE FROM playlist_profile WHERE playlist_id = ${PROF_PLAYLIST}`;
	await sql`DELETE FROM playlist WHERE id = ${PROF_PLAYLIST}`;
	await sql`DELETE FROM song WHERE id = ${PROF_SONG}`;
	await sql`DELETE FROM account WHERE id = ${PROF_ACCOUNT}`;
}

describeLocal(
	"publish_match_snapshot captures the newest playlist profile",
	() => {
		beforeAll(async () => {
			if (!sql) return;
			await cleanupProfileFixture();
			await seedProfileFixture();
		});

		afterAll(async () => {
			if (!sql) return;
			await cleanupProfileFixture();
		});

		it("maps the snapshot's playlist to the newest profile row by updated_at", async () => {
			const result = db().json([
				{
					song_id: PROF_SONG,
					playlist_id: PROF_PLAYLIST,
					score: 0.9,
					fused_score: 0.9,
					rank: 1,
					factors: {},
					normalized_factors: {},
				},
			]);
			const published = await db()`
      SELECT publish_match_snapshot(
        ${PROF_ACCOUNT}, ${"v1"}, ${"cfg"}, ${"pls"}, ${"cand"}, ${"prof-snap-hash"}, ${1}, ${1}, ${result}
      ) AS snapshot_id
    `;
			const snapshotId = published[0].snapshot_id as string;
			expect(snapshotId).toBeTruthy();

			const mapping = await db()`
      SELECT profile_id FROM match_snapshot_playlist_profile
      WHERE snapshot_id = ${snapshotId} AND playlist_id = ${PROF_PLAYLIST}
    `;
			expect(mapping).toHaveLength(1);
			// The newer row wins, pinning the exact intent behind the served results.
			expect(mapping[0].profile_id).toBe(PROF_NEW);
		});
	},
);

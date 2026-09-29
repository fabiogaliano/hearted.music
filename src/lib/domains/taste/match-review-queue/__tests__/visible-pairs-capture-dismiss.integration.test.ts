/**
 * First-presentation capture and whole-card dismiss against the real plpgsql:
 * capture_match_review_item_visible_pairs_atomic (20260625080000) and
 * dismiss_match_review_item_atomic (latest: 20260706000009). The unit suites
 * mock the RPC response, so the validation, first-capture-wins idempotency,
 * subject guard, and the dismiss fan-out over captured pairs only exist here.
 *
 * Expected values come from the SQL: capture validates shape → dense ranks →
 * item lookup/resolved → idempotency → subject; dismiss writes one 'dismissed'
 * decision per captured pair that has no added/dismissed decision for the item.
 *
 * Seeds via postgres.js (DATABASE_URL) and drives the production wrappers,
 * which go through the admin Supabase client. Auto-skipped unless both point
 * at the local stack.
 */

import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureVisiblePairsAtomic } from "../capture-visible-pairs";
import { dismissQueueItemAtomically } from "../queries";
import type { VisibleSuggestion } from "../visible-suggestion-list";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const IS_LOCAL =
	(DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost")) &&
	SUPABASE_URL.startsWith("http://127.0.0.1");

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 2, fetch_types: false })
	: null;

function db() {
	if (!sql) throw new Error("postgres client not initialised");
	return sql;
}

type Orientation = "song" | "playlist";

interface Fixture {
	accountId: string;
	snapshotId: string;
	sessions: Record<Orientation, string>;
	songs: [string, string, string];
	playlists: [string, string];
	nextPosition: number;
}

let fx: Fixture | null = null;

function fixture(): Fixture {
	if (!fx) throw new Error("fixture not seeded");
	return fx;
}

async function seedFixture(): Promise<Fixture> {
	const client = db();
	const accountId = crypto.randomUUID();
	const snapshotId = crypto.randomUUID();
	const songs: Fixture["songs"] = [
		crypto.randomUUID(),
		crypto.randomUUID(),
		crypto.randomUUID(),
	];
	const playlists: Fixture["playlists"] = [
		crypto.randomUUID(),
		crypto.randomUUID(),
	];
	const sessions = {
		song: crypto.randomUUID(),
		playlist: crypto.randomUUID(),
	};

	await client`INSERT INTO account(id, spotify_id) VALUES (${accountId}, ${`test-${accountId}`})`;
	for (const id of songs) {
		// fetch_types:false disables array inference, so bind array literals.
		await client`
      INSERT INTO song(id, spotify_id, name, artists, artist_ids, genres)
      VALUES (${id}, ${`sp-${id}`}, ${"Song"}, ${"{Artist}"}::text[], ${"{artist-1}"}::text[], ${"{pop}"}::text[])
    `;
	}
	for (const id of playlists) {
		await client`
      INSERT INTO playlist(id, account_id, spotify_id, name)
      VALUES (${id}, ${accountId}, ${`sp-pl-${id}`}, ${"Playlist"})
    `;
	}
	await client`
    INSERT INTO match_snapshot(id, account_id, algorithm_version, config_hash, playlist_set_hash, candidate_set_hash, snapshot_hash)
    VALUES (${snapshotId}, ${accountId}, ${"v1"}, ${"c"}, ${"p"}, ${"cand"}, ${"snap"})
  `;
	for (const orientation of ["song", "playlist"] as const) {
		await client`
      INSERT INTO match_review_session(id, account_id, status, strictness_preset, strictness_min_score, orientation)
      VALUES (${sessions[orientation]}, ${accountId}, ${"active"}, ${"balanced"}, ${0.5}, ${orientation})
    `;
	}

	return {
		accountId,
		snapshotId,
		sessions,
		songs,
		playlists,
		nextPosition: 0,
	};
}

async function teardownFixture(f: Fixture) {
	// Account cascade clears every account-scoped row (items, pairs, decisions,
	// events, deck jobs, snapshot); songs are global and go separately.
	await db()`DELETE FROM account WHERE id = ${f.accountId}`;
	await db()`DELETE FROM song WHERE id IN ${db()(f.songs)}`;
}

async function makeItem(opts: {
	orientation: Orientation;
	subjectId: string;
	state?: "pending" | "active" | "resolved";
}): Promise<string> {
	const f = fixture();
	const id = crypto.randomUUID();
	const songId = opts.orientation === "song" ? opts.subjectId : null;
	const playlistId = opts.orientation === "playlist" ? opts.subjectId : null;
	const position = f.nextPosition++;
	await db()`
    INSERT INTO match_review_queue_item(id, session_id, account_id, song_id, playlist_id, orientation, source_snapshot_id, position, state)
    VALUES (${id}, ${f.sessions[opts.orientation]}, ${f.accountId}, ${songId}, ${playlistId}, ${opts.orientation}, ${f.snapshotId}, ${position}, ${opts.state ?? "pending"})
  `;
	return id;
}

function pair(
	songId: string,
	playlistId: string,
	visibleRank: number,
): VisibleSuggestion {
	return {
		songId,
		playlistId,
		modelRank: visibleRank + 10,
		visibleRank,
		fitScore: 0.8,
	};
}

async function itemRow(itemId: string) {
	const rows = await db()`
    SELECT state, resolution, visible_pairs_captured_at
    FROM match_review_queue_item WHERE id = ${itemId}
  `;
	return rows[0];
}

async function pairRows(itemId: string) {
	return db()`
    SELECT song_id, playlist_id, visible_rank
    FROM match_review_item_visible_pair
    WHERE queue_item_id = ${itemId}
    ORDER BY visible_rank
  `;
}

async function decisionRows(itemId: string) {
	return db()`
    SELECT song_id, playlist_id, decision, served_orientation, visible_rank
    FROM match_decision
    WHERE queue_item_id = ${itemId}
    ORDER BY visible_rank
  `;
}

beforeEach(async () => {
	if (!IS_LOCAL) return;
	fx = await seedFixture();
});

afterEach(async () => {
	if (!IS_LOCAL || !fx) return;
	await teardownFixture(fx);
	fx = null;
});

afterAll(async () => {
	await sql?.end();
});

describe.skipIf(!IS_LOCAL)(
	"capture_match_review_item_visible_pairs_atomic",
	() => {
		it("captures pairs, stamps the capture time, and activates a pending item", async () => {
			const { songs, playlists } = fixture();
			const itemId = await makeItem({
				orientation: "song",
				subjectId: songs[0],
			});

			const result = await captureVisiblePairsAtomic(
				itemId,
				fixture().accountId,
				[pair(songs[0], playlists[0], 1), pair(songs[0], playlists[1], 2)],
			);

			expect(result).toEqual({ status: "captured" });
			expect(await pairRows(itemId)).toEqual([
				{ song_id: songs[0], playlist_id: playlists[0], visible_rank: 1 },
				{ song_id: songs[0], playlist_id: playlists[1], visible_rank: 2 },
			]);
			const item = await itemRow(itemId);
			expect(item.state).toBe("active");
			expect(item.visible_pairs_captured_at).not.toBeNull();
		});

		it.each([
			{
				name: "a pair missing required fields",
				pairs: (s: string, p: string) => [
					{ songId: s, playlistId: p } as unknown as VisibleSuggestion,
				],
				reason: /missing required fields/,
			},
			{
				name: "a non-uuid id",
				pairs: (_s: string, p: string) => [pair("not-a-uuid", p, 1)],
				reason: /type mismatch/,
			},
			{
				name: "non-dense visible ranks (1, 3)",
				pairs: (s: string, p: string) => [pair(s, p, 1), pair(s, p, 3)],
				reason: /dense/,
			},
			{
				name: "duplicate visible ranks (1, 1)",
				pairs: (s: string, p: string) => [pair(s, p, 1), pair(s, p, 1)],
				reason: /dense/,
			},
		])("rejects $name as invalid_input and writes nothing", async ({
			pairs,
			reason,
		}) => {
			const { songs, playlists, accountId } = fixture();
			const itemId = await makeItem({
				orientation: "song",
				subjectId: songs[0],
			});

			const result = await captureVisiblePairsAtomic(
				itemId,
				accountId,
				pairs(songs[0], playlists[0]),
			);

			expect(result).toEqual({
				status: "invalid_input",
				reason: expect.stringMatching(reason),
			});
			expect(await pairRows(itemId)).toEqual([]);
			const item = await itemRow(itemId);
			expect(item.state).toBe("pending");
			expect(item.visible_pairs_captured_at).toBeNull();
		});

		it("rejects a pair whose song is not the song-orientation item's subject", async () => {
			const { songs, playlists, accountId } = fixture();
			const itemId = await makeItem({
				orientation: "song",
				subjectId: songs[0],
			});

			const result = await captureVisiblePairsAtomic(itemId, accountId, [
				pair(songs[0], playlists[0], 1),
				pair(songs[1], playlists[1], 2),
			]);

			expect(result).toEqual({
				status: "invalid_input",
				reason: expect.stringMatching(/song_id mismatch/),
			});
			expect(await pairRows(itemId)).toEqual([]);
			expect((await itemRow(itemId)).visible_pairs_captured_at).toBeNull();
		});

		it("returns not_found for another account's item and leaves it untouched", async () => {
			const { songs, playlists } = fixture();
			const itemId = await makeItem({
				orientation: "song",
				subjectId: songs[0],
			});

			const result = await captureVisiblePairsAtomic(
				itemId,
				crypto.randomUUID(),
				[pair(songs[0], playlists[0], 1)],
			);

			expect(result).toEqual({ status: "not_found" });
			expect(await pairRows(itemId)).toEqual([]);
		});

		it("keeps the first capture and returns its rows when called again with different pairs", async () => {
			const { songs, playlists, accountId } = fixture();
			const itemId = await makeItem({
				orientation: "song",
				subjectId: songs[0],
			});
			await captureVisiblePairsAtomic(itemId, accountId, [
				pair(songs[0], playlists[1], 1),
				pair(songs[0], playlists[0], 2),
			]);

			const retry = await captureVisiblePairsAtomic(itemId, accountId, [
				pair(songs[0], playlists[0], 1),
			]);

			expect(retry).toEqual({
				status: "already_captured",
				pairs: [
					{
						songId: songs[0],
						playlistId: playlists[1],
						modelRank: 11,
						visibleRank: 1,
						fitScore: 0.8,
					},
					{
						songId: songs[0],
						playlistId: playlists[0],
						modelRank: 12,
						visibleRank: 2,
						fitScore: 0.8,
					},
				],
			});
			expect(await pairRows(itemId)).toHaveLength(2);
		});

		it("returns already_resolved for a resolved item without capturing", async () => {
			const { songs, playlists, accountId } = fixture();
			const itemId = await makeItem({
				orientation: "song",
				subjectId: songs[0],
				state: "resolved",
			});

			const result = await captureVisiblePairsAtomic(itemId, accountId, [
				pair(songs[0], playlists[0], 1),
			]);

			expect(result).toEqual({ status: "already_resolved" });
			expect(await pairRows(itemId)).toEqual([]);
			expect((await itemRow(itemId)).visible_pairs_captured_at).toBeNull();
		});

		it("an empty capture still stamps the capture time and activates the item", async () => {
			const { songs, accountId } = fixture();
			const itemId = await makeItem({
				orientation: "song",
				subjectId: songs[0],
			});

			const result = await captureVisiblePairsAtomic(itemId, accountId, []);

			expect(result).toEqual({ status: "empty" });
			expect(await pairRows(itemId)).toEqual([]);
			const item = await itemRow(itemId);
			expect(item.state).toBe("active");
			expect(item.visible_pairs_captured_at).not.toBeNull();
		});
	},
);

describe.skipIf(!IS_LOCAL)("dismiss_match_review_item_atomic", () => {
	it("song card: dismisses every captured pair except one already added, and resolves the item", async () => {
		const { songs, playlists, accountId } = fixture();
		const itemId = await makeItem({ orientation: "song", subjectId: songs[0] });
		await captureVisiblePairsAtomic(itemId, accountId, [
			pair(songs[0], playlists[0], 1),
			pair(songs[0], playlists[1], 2),
		]);
		await db()`
      INSERT INTO match_decision(account_id, song_id, playlist_id, decision, queue_item_id, visible_rank)
      VALUES (${accountId}, ${songs[0]}, ${playlists[0]}, ${"added"}, ${itemId}, ${1})
    `;

		const result = await dismissQueueItemAtomically(itemId, accountId);

		expect(result).toHaveOkValue("dismissed");
		expect(await decisionRows(itemId)).toEqual([
			{
				song_id: songs[0],
				playlist_id: playlists[0],
				decision: "added",
				served_orientation: null,
				visible_rank: 1,
			},
			{
				song_id: songs[0],
				playlist_id: playlists[1],
				decision: "dismissed",
				served_orientation: "song",
				visible_rank: 2,
			},
		]);
		const item = await itemRow(itemId);
		expect(item.state).toBe("resolved");
		expect(item.resolution).toBe("dismissed");
	});

	it("playlist card: dismisses every captured song against the subject playlist and resolves the item", async () => {
		const { songs, playlists, accountId } = fixture();
		const itemId = await makeItem({
			orientation: "playlist",
			subjectId: playlists[0],
		});
		await captureVisiblePairsAtomic(itemId, accountId, [
			pair(songs[1], playlists[0], 1),
			pair(songs[2], playlists[0], 2),
		]);

		const result = await dismissQueueItemAtomically(itemId, accountId);

		expect(result).toHaveOkValue("dismissed");
		expect(await decisionRows(itemId)).toEqual([
			{
				song_id: songs[1],
				playlist_id: playlists[0],
				decision: "dismissed",
				served_orientation: "playlist",
				visible_rank: 1,
			},
			{
				song_id: songs[2],
				playlist_id: playlists[0],
				decision: "dismissed",
				served_orientation: "playlist",
				visible_rank: 2,
			},
		]);
		const item = await itemRow(itemId);
		expect(item.state).toBe("resolved");
		expect(item.resolution).toBe("dismissed");
	});
});

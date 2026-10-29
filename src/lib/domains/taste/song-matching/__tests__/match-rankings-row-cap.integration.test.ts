/**
 * Playlist-orientation rankings are read through PostgREST, which caps each
 * response at max_rows (1000 locally, supabase/config.toml). Seeds through
 * postgres.js against DATABASE_URL; auto-skipped unless that is the local stack.
 */

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMatchRankingsForPlaylist } from "../queries";

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
const PLAYLIST_ID = crypto.randomUUID();
const SNAPSHOT_ID = crypto.randomUUID();
// One past max_rows, so a single-request read loses the lowest-ranked song.
const RANKING_COUNT = 1001;
const SONG_TAG = `rankings-row-cap-${ACCOUNT_ID}`;

beforeAll(async () => {
	if (!IS_LOCAL) return;
	const client = db();
	await client`INSERT INTO account(id, spotify_id) VALUES (${ACCOUNT_ID}, ${`test-${ACCOUNT_ID}`})`;
	await client`
		INSERT INTO playlist(id, account_id, spotify_id, name)
		VALUES (${PLAYLIST_ID}, ${ACCOUNT_ID}, ${`${SONG_TAG}-playlist`}, ${"Row Cap Playlist"})
	`;
	await client`
		INSERT INTO match_snapshot(id, account_id, algorithm_version, config_hash, playlist_set_hash, candidate_set_hash, snapshot_hash)
		VALUES (${SNAPSHOT_ID}, ${ACCOUNT_ID}, ${"v1"}, ${"c"}, ${"p"}, ${"cand"}, ${"snap"})
	`;
	await client`
		INSERT INTO song(id, spotify_id, name, artists, artist_ids)
		SELECT gen_random_uuid(), ${SONG_TAG} || '-' || n, 'Row Cap Song', '{Artist}'::text[], '{art-1}'::text[]
		FROM generate_series(1, ${RANKING_COUNT}) AS n
	`;
	await client`
		INSERT INTO match_result(snapshot_id, song_id, playlist_id, score, rank)
		SELECT ${SNAPSHOT_ID}, s.id, ${PLAYLIST_ID}, 0.5, row_number() OVER (ORDER BY s.spotify_id)
		FROM song s WHERE s.spotify_id LIKE ${`${SONG_TAG}-%`}
	`;
	await client`
		INSERT INTO match_result_ranking(snapshot_id, song_id, playlist_id, orientation, rank, ordering_score, source, document_mode)
		SELECT snapshot_id, song_id, playlist_id, 'playlist', rank, 0.5, 'fused_fallback', 'metadata'
		FROM match_result WHERE snapshot_id = ${SNAPSHOT_ID}
	`;
}, 60_000);

afterAll(async () => {
	if (!sql) return;
	await sql`DELETE FROM match_snapshot WHERE id = ${SNAPSHOT_ID}`;
	await sql`DELETE FROM account WHERE id = ${ACCOUNT_ID}`;
	await sql`DELETE FROM song WHERE spotify_id LIKE ${`${SONG_TAG}-%`}`;
	await sql.end();
});

describeLocal("getMatchRankingsForPlaylist", () => {
	it("regression: returns every ranking past the PostgREST row cap (a single read stopped at rank 1000, so lower-ranked songs fell back to fit-score order)", async () => {
		const result = await getMatchRankingsForPlaylist(SNAPSHOT_ID, PLAYLIST_ID);

		const ranks = result.unwrap().map((row) => row.rank);
		expect(ranks).toEqual(
			Array.from({ length: RANKING_COUNT }, (_, i) => i + 1),
		);
	});
});

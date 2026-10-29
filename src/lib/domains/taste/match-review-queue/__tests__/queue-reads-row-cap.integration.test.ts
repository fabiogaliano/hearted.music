/**
 * Review-queue reads go through PostgREST, which caps each response at
 * max_rows (1000 locally, supabase/config.toml). Seeds through postgres.js
 * against DATABASE_URL; auto-skipped unless that is the local stack.
 */

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	fetchProposalSubjects,
	fetchQueuedPlaylistIds,
	fetchQueuedSongIds,
	fetchQueueItems,
} from "../queries";

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
const SNAPSHOT_ID = crypto.randomUUID();
const SONG_SESSION_ID = crypto.randomUUID();
const PLAYLIST_SESSION_ID = crypto.randomUUID();
const PROPOSAL_ID = crypto.randomUUID();
// One past max_rows, so a single-request read loses the last row.
const ROW_COUNT = 1001;
const TAG = `queue-row-cap-${ACCOUNT_ID}`;
const POSITIONS = Array.from({ length: ROW_COUNT }, (_, i) => i);

beforeAll(async () => {
	if (!IS_LOCAL) return;
	const client = db();
	await client`INSERT INTO account(id, spotify_id) VALUES (${ACCOUNT_ID}, ${`test-${ACCOUNT_ID}`})`;
	await client`
		INSERT INTO match_snapshot(id, account_id, algorithm_version, config_hash, playlist_set_hash, candidate_set_hash, snapshot_hash)
		VALUES (${SNAPSHOT_ID}, ${ACCOUNT_ID}, ${"v1"}, ${"c"}, ${"p"}, ${"cand"}, ${"snap"})
	`;
	await client`
		INSERT INTO song(id, spotify_id, name, artists, artist_ids)
		SELECT gen_random_uuid(), ${TAG} || '-' || n, 'Row Cap Song', '{Artist}'::text[], '{art-1}'::text[]
		FROM generate_series(0, ${ROW_COUNT - 1}) AS n
	`;
	await client`
		INSERT INTO playlist(id, account_id, spotify_id, name)
		SELECT gen_random_uuid(), ${ACCOUNT_ID}::uuid, ${TAG} || '-' || n, 'Row Cap Playlist'
		FROM generate_series(0, ${ROW_COUNT - 1}) AS n
	`;
	await client`
		INSERT INTO match_review_session(id, account_id, status, strictness_preset, strictness_min_score, orientation)
		VALUES
			(${SONG_SESSION_ID}, ${ACCOUNT_ID}, 'active', 'balanced', 0.5, 'song'),
			(${PLAYLIST_SESSION_ID}, ${ACCOUNT_ID}, 'active', 'balanced', 0.5, 'playlist')
	`;
	// Each song or playlist's tag suffix doubles as its queue position.
	await client`
		INSERT INTO match_review_queue_item(session_id, account_id, orientation, song_id, source_snapshot_id, position, state)
		SELECT ${SONG_SESSION_ID}::uuid, ${ACCOUNT_ID}::uuid, 'song', s.id, ${SNAPSHOT_ID}::uuid,
			split_part(s.spotify_id, '-', -1)::int, 'pending'
		FROM song s WHERE s.spotify_id LIKE ${`${TAG}-%`}
	`;
	await client`
		INSERT INTO match_review_queue_item(session_id, account_id, orientation, playlist_id, source_snapshot_id, position, state)
		SELECT ${PLAYLIST_SESSION_ID}::uuid, ${ACCOUNT_ID}::uuid, 'playlist', p.id, ${SNAPSHOT_ID}::uuid,
			split_part(p.spotify_id, '-', -1)::int, 'pending'
		FROM playlist p WHERE p.account_id = ${ACCOUNT_ID}
	`;
	await client`
		INSERT INTO match_review_proposal(id, account_id, orientation, snapshot_id, visibility_config_hash, strictness_preset, strictness_min_score, read_time_filters_hash, status)
		VALUES (${PROPOSAL_ID}, ${ACCOUNT_ID}, 'song', ${SNAPSHOT_ID}, 'vh', 'balanced', 0.5, 'rf', 'ready')
	`;
	await client`
		INSERT INTO match_review_proposal_subject(proposal_id, position, orientation, song_id)
		SELECT ${PROPOSAL_ID}::uuid, split_part(s.spotify_id, '-', -1)::int, 'song', s.id
		FROM song s WHERE s.spotify_id LIKE ${`${TAG}-%`}
	`;
}, 60_000);

afterAll(async () => {
	if (!sql) return;
	await sql`DELETE FROM match_review_proposal WHERE id = ${PROPOSAL_ID}`;
	await sql`DELETE FROM match_review_session WHERE account_id = ${ACCOUNT_ID}`;
	await sql`DELETE FROM match_snapshot WHERE id = ${SNAPSHOT_ID}`;
	await sql`DELETE FROM account WHERE id = ${ACCOUNT_ID}`;
	await sql`DELETE FROM song WHERE spotify_id LIKE ${`${TAG}-%`}`;
	await sql.end();
});

async function songIds(): Promise<Set<string>> {
	const rows =
		await db()`SELECT id FROM song WHERE spotify_id LIKE ${`${TAG}-%`}`;
	return new Set(rows.map((row) => row.id as string));
}

async function playlistIds(): Promise<Set<string>> {
	const rows =
		await db()`SELECT id FROM playlist WHERE account_id = ${ACCOUNT_ID}`;
	return new Set(rows.map((row) => row.id as string));
}

describeLocal("review-queue reads past the PostgREST row cap", () => {
	it("regression: fetchQueuedSongIds returns every queued song (a single read stopped at 1000, so the appender queued the rest again)", async () => {
		const result = await fetchQueuedSongIds(SONG_SESSION_ID);

		expect(result.unwrap()).toEqual(await songIds());
	});

	it("regression: fetchQueuedPlaylistIds returns every queued playlist (a single read stopped at 1000, so the appender queued the rest again)", async () => {
		const result = await fetchQueuedPlaylistIds(PLAYLIST_SESSION_ID);

		expect(result.unwrap()).toEqual(await playlistIds());
	});

	it("regression: fetchQueueItems returns the whole session in order (a single read stopped at position 999)", async () => {
		const result = await fetchQueueItems(SONG_SESSION_ID);

		expect(result.unwrap().map((item) => item.position)).toEqual(POSITIONS);
	});

	it("regression: fetchProposalSubjects returns every subject in order (a single read stopped at 1000, so later subjects were never appended)", async () => {
		const result = await fetchProposalSubjects(PROPOSAL_ID);

		expect(result.unwrap().map((subject) => subject.position)).toEqual(
			POSITIONS,
		);
	});
});

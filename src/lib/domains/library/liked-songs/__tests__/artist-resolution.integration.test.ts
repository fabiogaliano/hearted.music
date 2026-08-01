import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL =
	DATABASE_URL.includes("127.0.0.1") || DATABASE_URL.includes("localhost");

const sql = IS_LOCAL
	? postgres(DATABASE_URL, { prepare: false, max: 1 })
	: null;

function db() {
	if (!sql) throw new Error("postgres client not initialised");
	return sql;
}

const describeLocal = IS_LOCAL ? describe : describe.skip;

const ACCOUNT = "00000000-0000-4000-8000-00000000a711";
const GENRE_SONG = "00000000-0000-4000-8000-00000000a712";
const AUDIO_SONG = "00000000-0000-4000-8000-00000000a713";
const UNENRICHED_SONG = "00000000-0000-4000-8000-00000000a714";
const UNLIKED_SONG = "00000000-0000-4000-8000-00000000a715";
const SONG_IDS = [GENRE_SONG, AUDIO_SONG, UNENRICHED_SONG, UNLIKED_SONG];

async function cleanup() {
	if (!sql) return;
	await sql`DELETE FROM song_audio_feature WHERE song_id IN ${sql(SONG_IDS)}`;
	await sql`DELETE FROM liked_song WHERE account_id = ${ACCOUNT}`;
	await sql`DELETE FROM song WHERE id IN ${sql(SONG_IDS)}`;
	await sql`DELETE FROM account WHERE id = ${ACCOUNT}`;
}

async function seed() {
	const client = db();
	await client`INSERT INTO account(id, spotify_id) VALUES (${ACCOUNT}, ${"sp-artist-resolution"})`;
	await client`
		INSERT INTO song(id, spotify_id, name, artists, artist_ids, genres)
		VALUES
			(${GENRE_SONG}, ${"sp-genre"}, ${"Genre Song"}, ${"{Artist A}"}::TEXT[], ${"{artist-a}"}::TEXT[], ${"{pop}"}::TEXT[]),
			(${AUDIO_SONG}, ${"sp-audio"}, ${"Audio Song"}, ${"{Artist A,Artist B}"}::TEXT[], ${"{artist-a,artist-b}"}::TEXT[], ${"{}"}::TEXT[]),
			(${UNENRICHED_SONG}, ${"sp-unenriched"}, ${"Unenriched Song"}, ${"{Artist A}"}::TEXT[], ${"{artist-a}"}::TEXT[], ${"{}"}::TEXT[]),
			(${UNLIKED_SONG}, ${"sp-unliked"}, ${"Unliked Song"}, ${"{Artist A}"}::TEXT[], ${"{artist-a}"}::TEXT[], ${"{pop}"}::TEXT[])
	`;
	await client`
		INSERT INTO liked_song(account_id, song_id, liked_at, unliked_at)
		VALUES
			(${ACCOUNT}, ${GENRE_SONG}, ${"2026-01-04T00:00:00Z"}, NULL),
			(${ACCOUNT}, ${AUDIO_SONG}, ${"2026-01-03T00:00:00Z"}, NULL),
			(${ACCOUNT}, ${UNENRICHED_SONG}, ${"2026-01-02T00:00:00Z"}, NULL),
			(${ACCOUNT}, ${UNLIKED_SONG}, ${"2026-01-05T00:00:00Z"}, ${"2026-01-06T00:00:00Z"})
	`;
	// A present row is Phase-1 evidence even before individual feature values land.
	await client`INSERT INTO song_audio_feature(song_id) VALUES (${AUDIO_SONG})`;
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

describeLocal("resolve_artist_liked_songs", () => {
	it("returns preview-eligible pools in recency order for every requested artist", async () => {
		const rows = await db()`
			SELECT *
			FROM resolve_artist_liked_songs(
				${ACCOUNT},
				ARRAY['Artist A', 'Artist B', 'Nobody']::TEXT[]
			)
		`;

		expect(rows).toEqual([
			{ artist: "Artist A", song_ids: [GENRE_SONG, AUDIO_SONG] },
			{ artist: "Artist B", song_ids: [AUDIO_SONG] },
			{ artist: "Nobody", song_ids: [] },
		]);
	});
});

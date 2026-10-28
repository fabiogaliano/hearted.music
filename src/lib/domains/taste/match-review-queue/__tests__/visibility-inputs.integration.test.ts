/**
 * loadVisibilityInputs against the real select_match_visibility_inputs
 * (20261028120000): the joins that decide entitlement, ownership, decisions,
 * the already-in-playlist exclusion and the per-playlist filters only exist in
 * SQL, so mocks cannot pin them.
 *
 * Expected values are hand-derived from makeVisibilityScenario: the entitled
 * song is liked + enriched + unlocked; the locked song is liked + enriched with
 * no unlock on a free account.
 *
 * Seeds via postgres.js (DATABASE_URL) and reads through the admin Supabase
 * client. Auto-skipped unless both point at the local stack.
 */

import { Result } from "better-result";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { makeVisibilityScenario } from "@/test/fixtures";
import {
	loadVisibilityInputs,
	type VisibilityInputs,
} from "../visibility-inputs";

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

type Scenario = ReturnType<typeof makeVisibilityScenario>;

const ZERO_VECTOR = `[${new Array(512).fill(0).join(",")}]`;

async function insertAccount(accountId: string) {
	await db()`INSERT INTO account(id, spotify_id) VALUES (${accountId}, ${`test-${accountId}`})`;
	await db()`
    INSERT INTO account_billing(account_id, plan, unlimited_access_source, subscription_status)
    VALUES (${accountId}, ${"free"}, ${null}, ${"none"})
  `;
}

async function insertSnapshot(snapshotId: string, accountId: string) {
	await db()`
    INSERT INTO match_snapshot(id, account_id, algorithm_version, config_hash, playlist_set_hash, candidate_set_hash, snapshot_hash)
    VALUES (${snapshotId}, ${accountId}, ${"v1"}, ${"c"}, ${"p"}, ${"cand"}, ${"snap"})
  `;
}

async function seed(s: Scenario) {
	const client = db();
	await insertAccount(s.accountId);
	await insertAccount(s.otherAccountId);

	for (const song of Object.values(s.songs)) {
		// fetch_types:false disables array inference, so bind array literals.
		await client`
      INSERT INTO song(id, spotify_id, name, artists, artist_ids, genres, language, release_year)
      VALUES (${song.id}, ${`sp-${song.id}`}, ${"Song"}, ${"{Artist}"}::text[], ${"{artist-1}"}::text[], ${"{pop}"}::text[],
              ${song.language}, ${song.release_year})
    `;
		// The insert trigger derives vocal_gender from artist rows; set it after.
		await client`UPDATE song SET vocal_gender = ${song.vocal_gender} WHERE id = ${song.id}`;
		await client`
      INSERT INTO liked_song(account_id, song_id, liked_at)
      VALUES (${s.accountId}, ${song.id}, ${song.liked_at})
    `;
		// Both songs are data-enriched, so the unlock alone separates them.
		await client`
      INSERT INTO song_analysis(song_id, analysis, model)
      VALUES (${song.id}, ${client.json({ mood: ["test"] })}, ${"test-model"})
    `;
		await client`
      INSERT INTO song_embedding(song_id, kind, model, dims, content_hash, embedding)
      VALUES (${song.id}, ${"song_semantic"}, ${"test-embed-model"}, ${512}, ${`hash-${song.id}`}, ${ZERO_VECTOR})
    `;
		if (song.unlocked) {
			await client`
        INSERT INTO account_song_unlock(account_id, song_id, source)
        VALUES (${s.accountId}, ${song.id}, ${"free_auto"})
      `;
		}
	}

	for (const p of Object.values(s.playlists)) {
		await client`
      INSERT INTO playlist(id, account_id, spotify_id, name, is_target, match_filters)
      VALUES (${p.id}, ${p.account_id}, ${`sp-pl-${p.id}`}, ${p.name}, ${p.is_target}, ${client.json(p.match_filters)})
    `;
	}

	await insertSnapshot(s.snapshotId, s.accountId);
	await insertSnapshot(s.otherSnapshotId, s.otherAccountId);
	for (const pair of s.pairs) {
		await client`
      INSERT INTO match_result(snapshot_id, song_id, playlist_id, score)
      VALUES (${s.snapshotId}, ${pair.song.id}, ${pair.playlist.id}, ${pair.score})
    `;
	}
	// The other account's snapshot holds a pair the scenario account must never read.
	await client`
    INSERT INTO match_result(snapshot_id, song_id, playlist_id, score)
    VALUES (${s.otherSnapshotId}, ${s.songs.entitled.id}, ${s.playlists.foreign.id}, ${0.99})
  `;

	for (const ps of s.playlistSongs) {
		await client`INSERT INTO playlist_song(playlist_id, song_id) VALUES (${ps.playlist.id}, ${ps.song.id})`;
	}
	for (const d of s.decisions) {
		await client`
      INSERT INTO match_decision(account_id, song_id, playlist_id, decision)
      VALUES (${s.accountId}, ${d.song.id}, ${d.playlist.id}, ${"added"})
    `;
	}
}

async function teardown(s: Scenario) {
	// Account cascade clears playlists, snapshots, results, decisions, likes and
	// unlocks; songs are global and go separately (cascading their artifacts).
	await db()`DELETE FROM account WHERE id IN ${db()([s.accountId, s.otherAccountId])}`;
	await db()`DELETE FROM song WHERE id IN ${db()(Object.values(s.songs).map((x) => x.id))}`;
}

function pairKeys(inputs: VisibilityInputs): string[] {
	return inputs.pairs.map((p) => `${p.song_id}:${p.playlist_id}`).toSorted();
}

function key(song: { id: string }, playlist: { id: string }) {
	return `${song.id}:${playlist.id}`;
}

let scenario: Scenario | null = null;

function s(): Scenario {
	if (!scenario) throw new Error("scenario not seeded");
	return scenario;
}

beforeEach(async () => {
	if (!IS_LOCAL) return;
	scenario = makeVisibilityScenario();
	await seed(scenario);
});

afterEach(async () => {
	if (!IS_LOCAL || !scenario) return;
	await teardown(scenario);
	scenario = null;
});

afterAll(async () => {
	await sql?.end();
});

describe.skipIf(!IS_LOCAL)("loadVisibilityInputs", () => {
	it("account scope: every snapshot pair except one already in its playlist, with entitlement, ownership and decisions", async () => {
		const { songs, playlists } = s();

		const result = await loadVisibilityInputs(createAdminSupabaseClient(), {
			kind: "account",
			accountId: s().accountId,
			snapshotId: s().snapshotId,
		});

		expect(result).toBeOk();
		if (Result.isError(result)) return;
		const inputs = result.value;
		expect(pairKeys(inputs)).toEqual(
			[
				key(songs.entitled, playlists.target),
				key(songs.entitled, playlists.untargeted),
				key(songs.entitled, playlists.foreign),
				key(songs.locked, playlists.target),
				key(songs.locked, playlists.untargeted),
			].toSorted(),
		);
		expect([...inputs.entitledSongIds]).toEqual([songs.entitled.id]);
		expect([...inputs.ownedPlaylistIds].toSorted()).toEqual(
			[playlists.target.id, playlists.untargeted.id].toSorted(),
		);
		expect([...inputs.decidedPairs]).toEqual([
			key(songs.entitled, playlists.target),
		]);
		expect(inputs.songMetaBySongId.get(songs.entitled.id)).toEqual({
			language: "en",
			languageSecondary: null,
			releaseYear: 2010,
			vocalGender: "female",
			likedAt: Date.UTC(2024, 5, 2, 0, 30),
		});
		expect(inputs.songMetaBySongId.get(songs.locked.id)).toEqual({
			language: "fr",
			languageSecondary: null,
			releaseYear: null,
			vocalGender: null,
			likedAt: Date.UTC(2024, 0, 1),
		});
		expect(inputs.playlistsById.get(playlists.target.id)).toEqual({
			name: "Target",
			spotifyId: `sp-pl-${playlists.target.id}`,
		});
	});

	it("reads the filters of an untargeted playlist that appears in the pairs", async () => {
		const { playlists } = s();

		const result = await loadVisibilityInputs(createAdminSupabaseClient(), {
			kind: "account",
			accountId: s().accountId,
			snapshotId: s().snapshotId,
		});

		expect(result).toBeOk();
		if (Result.isError(result)) return;
		const filters = result.value.filtersByPlaylistId;
		expect(filters.get(playlists.untargeted.id)).toEqual({
			version: 1,
			languages: { codes: ["fr"] },
		});
		expect(filters.get(playlists.target.id)).toEqual({ version: 1 });
		// No pair survives for this playlist, so its filters are never read.
		expect(filters.has(playlists.containsEntitled.id)).toBe(false);
	});

	it("song scope: only the song's pairs", async () => {
		const { songs, playlists } = s();

		const result = await loadVisibilityInputs(createAdminSupabaseClient(), {
			kind: "song",
			songId: songs.entitled.id,
			accountId: s().accountId,
			snapshotId: s().snapshotId,
		});

		expect(result).toBeOk();
		if (Result.isError(result)) return;
		expect(pairKeys(result.value)).toEqual(
			[
				key(songs.entitled, playlists.target),
				key(songs.entitled, playlists.untargeted),
				key(songs.entitled, playlists.foreign),
			].toSorted(),
		);
	});

	it("playlist scope: only the playlist's pairs, locked songs flagged", async () => {
		const { songs, playlists } = s();

		const result = await loadVisibilityInputs(createAdminSupabaseClient(), {
			kind: "playlist",
			playlistId: playlists.untargeted.id,
			accountId: s().accountId,
			snapshotId: s().snapshotId,
		});

		expect(result).toBeOk();
		if (Result.isError(result)) return;
		expect(pairKeys(result.value)).toEqual(
			[
				key(songs.entitled, playlists.untargeted),
				key(songs.locked, playlists.untargeted),
			].toSorted(),
		);
		expect([...result.value.entitledSongIds]).toEqual([songs.entitled.id]);
	});

	it("reads nothing from a snapshot that belongs to another account", async () => {
		const result = await loadVisibilityInputs(createAdminSupabaseClient(), {
			kind: "account",
			accountId: s().accountId,
			snapshotId: s().otherSnapshotId,
		});

		expect(result).toBeOk();
		if (Result.isError(result)) return;
		expect(result.value.pairs).toEqual([]);
	});
});

describe.skipIf(!IS_LOCAL)("loadVisibilityInputs paging", () => {
	const SONG_COUNT = 30;
	const PLAYLIST_COUNT = 35;
	let accountId = "";
	let snapshotId = "";
	let songIds: string[] = [];

	beforeEach(async () => {
		accountId = crypto.randomUUID();
		snapshotId = crypto.randomUUID();
		await insertAccount(accountId);
		const songs = await db()`
      INSERT INTO song(spotify_id, name, artists, artist_ids, genres)
      SELECT ${`sp-page-${accountId}-`} || i, ${"Song"}, ${"{Artist}"}::text[], ${"{artist-1}"}::text[], ${"{pop}"}::text[]
      FROM generate_series(1, ${SONG_COUNT}) AS i
      RETURNING id
    `;
		songIds = songs.map((r) => r.id as string);
		await db()`
      INSERT INTO playlist(account_id, spotify_id, name)
      SELECT ${accountId}, ${`sp-page-pl-${accountId}-`} || i, ${"Playlist"}
      FROM generate_series(1, ${PLAYLIST_COUNT}) AS i
    `;
		await insertSnapshot(snapshotId, accountId);
		await db()`
      INSERT INTO match_result(snapshot_id, song_id, playlist_id, score)
      SELECT ${snapshotId}, s.id, p.id, 0.5
      FROM song s CROSS JOIN playlist p
      WHERE s.id IN ${db()(songIds)} AND p.account_id = ${accountId}
    `;
	});

	afterEach(async () => {
		await db()`DELETE FROM account WHERE id = ${accountId}`;
		await db()`DELETE FROM song WHERE id IN ${db()(songIds)}`;
	});

	it("reads every pair past PostgREST's 1,000-row cap, each once", async () => {
		const result = await loadVisibilityInputs(createAdminSupabaseClient(), {
			kind: "account",
			accountId,
			snapshotId,
		});

		expect(result).toBeOk();
		if (Result.isError(result)) return;
		const keys = pairKeys(result.value);
		expect(keys).toHaveLength(SONG_COUNT * PLAYLIST_COUNT);
		expect(new Set(keys).size).toBe(SONG_COUNT * PLAYLIST_COUNT);
	});
});

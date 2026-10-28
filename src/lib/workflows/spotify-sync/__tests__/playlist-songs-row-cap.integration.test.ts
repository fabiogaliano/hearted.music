/**
 * The playlist-track sync diff reads the playlist's whole membership through
 * PostgREST, which caps each response at max_rows (1000 locally,
 * supabase/config.toml). Auto-skipped unless SUPABASE_URL is the local stack.
 */

import { createClient } from "@supabase/supabase-js";
import { Result } from "better-result";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/data/database.types";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { syncPlaylistTracksFromData } from "../playlist-sync";
import type { SpotifyTrackDTO } from "../types";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const IS_LOCAL =
	SUPABASE_URL.startsWith("http://127.0.0.1") &&
	SUPABASE_SERVICE_ROLE_KEY.length > 0;

const supabase = IS_LOCAL
	? createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false },
		})
	: null;

function db() {
	if (!supabase) throw new Error("supabase client not initialised");
	return supabase;
}

const describeLocal = IS_LOCAL ? describe : describe.skip;

const ACCOUNT_ID = crypto.randomUUID();
const PLAYLIST_ID = crypto.randomUUID();
// Two past the local max_rows: positions 1000 and 1001 fall past a single read.
const SONG_COUNT = 1002;
// Cleanup by spotify_id prefix: 1002 ids would overflow an .in() URL.
const SONG_TAG = `playlist-row-cap-${ACCOUNT_ID}`;
const INSERT_CHUNK = 250;
const ADDED_AT = "2026-01-01T00:00:00.000Z";

// Array index is the playlist position.
const SONGS = Array.from({ length: SONG_COUNT }, () => {
	const id = crypto.randomUUID();
	return { id, spotifyId: `${SONG_TAG}-${id}` };
});

async function inChunks<T>(
	rows: T[],
	insert: (chunk: T[]) => PromiseLike<unknown>,
): Promise<void> {
	for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
		await insert(rows.slice(i, i + INSERT_CHUNK));
	}
}

function spotifyTrack(song: (typeof SONGS)[number]): SpotifyTrackDTO {
	return {
		added_at: ADDED_AT,
		track: {
			id: song.spotifyId,
			name: "Row Cap Song",
			artists: [{ id: `${SONG_TAG}-artist`, name: "Artist" }],
			album: { id: `${SONG_TAG}-album`, name: "Album", images: [] },
			duration_ms: 1000,
			uri: `spotify:track:${song.spotifyId}`,
		},
	};
}

let playlist: Playlist;

beforeAll(async () => {
	if (!IS_LOCAL) return;
	await db()
		.from("account")
		.insert({ id: ACCOUNT_ID, spotify_id: `test-${ACCOUNT_ID}` })
		.throwOnError();
	const { data } = await db()
		.from("playlist")
		.insert({
			id: PLAYLIST_ID,
			account_id: ACCOUNT_ID,
			spotify_id: `${SONG_TAG}-playlist`,
			name: "Row Cap Playlist",
			song_count: SONG_COUNT,
		})
		.select()
		.single()
		.throwOnError();
	playlist = data;
	await inChunks(
		SONGS.map((s) => ({
			id: s.id,
			spotify_id: s.spotifyId,
			name: "Row Cap Song",
			artists: ["Artist"],
			artist_ids: [`${SONG_TAG}-artist`],
		})),
		(chunk) => db().from("song").insert(chunk).throwOnError(),
	);
	await inChunks(
		SONGS.map((s, position) => ({
			playlist_id: PLAYLIST_ID,
			song_id: s.id,
			position,
			added_at: ADDED_AT,
		})),
		(chunk) => db().from("playlist_song").insert(chunk).throwOnError(),
	);
}, 120_000);

afterAll(async () => {
	if (!IS_LOCAL) return;
	await db().from("account").delete().eq("id", ACCOUNT_ID);
	await db().from("song").delete().like("spotify_id", `${SONG_TAG}-%`);
	await db().from("artist").delete().like("spotify_id", `${SONG_TAG}-%`);
});

describeLocal("playlist-track sync diff past the PostgREST row cap", () => {
	it("regression: a removal past position 1000 is synced and nothing past it re-adds (getPlaylistSongs silently truncated at 1000)", async () => {
		const removed = SONGS[SONG_COUNT - 1];
		const kept = SONGS.slice(0, -1);

		const synced = await syncPlaylistTracksFromData(
			playlist,
			kept.map(spotifyTrack),
		);
		if (Result.isError(synced)) throw synced.error;

		expect(synced.value.added).toBe(0);
		expect(synced.value.removedTracks).toEqual([{ id: removed.id }]);
		const { count } = await db()
			.from("playlist_song")
			.select("*", { count: "exact", head: true })
			.eq("playlist_id", PLAYLIST_ID)
			.eq("song_id", removed.id)
			.throwOnError();
		expect(count).toBe(0);
	});
});

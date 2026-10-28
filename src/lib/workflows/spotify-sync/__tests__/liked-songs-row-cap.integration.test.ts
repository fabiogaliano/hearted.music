/**
 * The liked-songs sync diff reads the whole library through PostgREST, which
 * caps each response at max_rows (1000 locally, supabase/config.toml).
 * Auto-skipped unless SUPABASE_URL is the local stack.
 */

import { createClient } from "@supabase/supabase-js";
import { Result } from "better-result";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/data/database.types";
import { getAll } from "@/lib/domains/library/liked-songs/queries";
import { incrementalSync } from "../sync-helpers";
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
// Two past the local max_rows: the two oldest songs fall past a single read.
const SONG_COUNT = 1002;
// Cleanup by spotify_id prefix: 1002 ids would overflow an .in() URL.
const SONG_TAG = `liked-row-cap-${ACCOUNT_ID}`;
const INSERT_CHUNK = 250;

// Index 0 is the newest like, so the last two are past row 1000.
const SONGS = Array.from({ length: SONG_COUNT }, (_, i) => {
	const id = crypto.randomUUID();
	return {
		id,
		spotifyId: `${SONG_TAG}-${id}`,
		likedAt: new Date(Date.UTC(2026, 0, 1) - i * 60_000).toISOString(),
	};
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
		added_at: song.likedAt,
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

beforeAll(async () => {
	if (!IS_LOCAL) return;
	await db()
		.from("account")
		.insert({ id: ACCOUNT_ID, spotify_id: `test-${ACCOUNT_ID}` })
		.throwOnError();
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
		SONGS.map((s) => ({
			account_id: ACCOUNT_ID,
			song_id: s.id,
			liked_at: s.likedAt,
		})),
		(chunk) => db().from("liked_song").insert(chunk).throwOnError(),
	);
}, 120_000);

afterAll(async () => {
	if (!IS_LOCAL) return;
	await db().from("account").delete().eq("id", ACCOUNT_ID);
	await db().from("song").delete().like("spotify_id", `${SONG_TAG}-%`);
	await db().from("artist").delete().like("spotify_id", `${SONG_TAG}-%`);
});

describeLocal("liked-songs sync diff past the PostgREST row cap", () => {
	it("regression: songs past row 1000 neither re-import as new nor hide an unlike (getAll silently truncated at 1000)", async () => {
		const unliked = SONGS[SONG_COUNT - 1];
		const stillLiked = SONGS.slice(0, -1);

		const existing = await getAll(ACCOUNT_ID);
		if (Result.isError(existing)) throw existing.error;

		const synced = await incrementalSync(ACCOUNT_ID, {
			likedSongs: stillLiked.map(spotifyTrack),
			existingLikedSongs: existing.value,
			likedSongsIds: new Set(stillLiked.map((s) => s.spotifyId)),
		});
		if (Result.isError(synced)) throw synced.error;

		expect(synced.value.added).toBe(0);
		expect(synced.value.removed).toBe(1);
		const { data: unlikedRow } = await db()
			.from("liked_song")
			.select("unliked_at")
			.eq("account_id", ACCOUNT_ID)
			.eq("song_id", unliked.id)
			.single()
			.throwOnError();
		expect(unlikedRow.unliked_at).not.toBeNull();
	});
});

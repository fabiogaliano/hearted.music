/**
 * has_target_only_songs (20261006100000) against the real SQL: whether any
 * song in the account's target playlists is outside its active liked library.
 * Auto-skipped unless SUPABASE_URL is the local stack.
 */

import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/data/database.types";
import { hasTargetOnlySongs } from "@/lib/domains/library/playlists/queries";

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

const seededAccounts: string[] = [];
// Songs are cleaned up by spotify_id prefix: deleting hundreds of ids through
// an .in() filter would overflow the URL, the very bug under test.
const SONG_TAG = `has-target-only-${crypto.randomUUID()}`;

async function seedAccount(): Promise<string> {
	const accountId = crypto.randomUUID();
	seededAccounts.push(accountId);
	await db()
		.from("account")
		.insert({ id: accountId, spotify_id: `test-${accountId}` })
		.throwOnError();
	return accountId;
}

async function seedPlaylist(
	accountId: string,
	isTarget: boolean,
	songIds: string[],
): Promise<void> {
	const playlistId = crypto.randomUUID();
	await db()
		.from("playlist")
		.insert({
			id: playlistId,
			account_id: accountId,
			spotify_id: `sp-${playlistId}`,
			name: "Test Playlist",
			is_target: isTarget,
		})
		.throwOnError();
	if (songIds.length === 0) return;
	await db()
		.from("playlist_song")
		.insert(
			songIds.map((songId, position) => ({
				playlist_id: playlistId,
				song_id: songId,
				position,
			})),
		)
		.throwOnError();
}

async function seedSongs(count: number): Promise<string[]> {
	const ids = Array.from({ length: count }, () => crypto.randomUUID());
	await db()
		.from("song")
		.insert(
			ids.map((id) => ({
				id,
				spotify_id: `${SONG_TAG}-${id}`,
				name: "Test Song",
				artists: ["Artist"],
				artist_ids: ["art-1"],
				genres: [],
			})),
		)
		.throwOnError();
	return ids;
}

async function like(
	accountId: string,
	songIds: string[],
	opts: { unliked?: boolean } = {},
): Promise<void> {
	const now = new Date().toISOString();
	await db()
		.from("liked_song")
		.insert(
			songIds.map((songId) => ({
				account_id: accountId,
				song_id: songId,
				liked_at: now,
				unliked_at: opts.unliked ? now : null,
			})),
		)
		.throwOnError();
}

afterEach(async () => {
	if (!supabase) return;
	if (seededAccounts.length > 0) {
		await db().from("account").delete().in("id", seededAccounts);
		seededAccounts.length = 0;
	}
	await db().from("song").delete().like("spotify_id", `${SONG_TAG}-%`);
});

describeLocal("hasTargetOnlySongs", () => {
	it("regression: finds a target-only song among hundreds of liked target songs (the URL-bound probe failed and answered false)", async () => {
		const accountId = await seedAccount();
		const liked = await seedSongs(300);
		const [notLiked] = await seedSongs(1);
		await like(accountId, liked);
		await seedPlaylist(accountId, true, [...liked, notLiked]);

		expect(await hasTargetOnlySongs(accountId)).toHaveOkValue(true);
	});

	it("is false when every target song is liked, ignoring non-target playlists", async () => {
		const accountId = await seedAccount();
		const [likedSong, otherSong] = await seedSongs(2);
		await like(accountId, [likedSong]);
		await seedPlaylist(accountId, true, [likedSong]);
		await seedPlaylist(accountId, false, [otherSong]);

		expect(await hasTargetOnlySongs(accountId)).toHaveOkValue(false);
	});

	it("counts an unliked song as target-only", async () => {
		const accountId = await seedAccount();
		const [song] = await seedSongs(1);
		await like(accountId, [song], { unliked: true });
		await seedPlaylist(accountId, true, [song]);

		expect(await hasTargetOnlySongs(accountId)).toHaveOkValue(true);
	});
});

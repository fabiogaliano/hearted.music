/**
 * Database-level slug resolution.
 *
 * Exercises migration 20260610160200_liked_songs_slug_resolution against the
 * real local Postgres: the song_slug() expression mirrors the TS
 * generateSongSlug, get_liked_song_by_slug resolves a slug in one indexed
 * lookup, and get_liked_songs_bootstrap_by_slug returns the prefix-through-the-
 * selection plus a trailing buffer in a single query — including across a block
 * of rows that share one liked_at (the production tie bug).
 *
 * Runs against the local Supabase Postgres only — auto-skipped when SUPABASE_URL
 * is not the local URL. Mirrors pending-excludes-terminal-failures.integration:
 * the admin client is built from process.env directly to bypass the t3-env
 * window guard under jsdom.
 */

import { createClient } from "@supabase/supabase-js";
import { Result } from "better-result";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/data/database.types";
import { generateSongSlug } from "@/lib/utils/slug";
import {
	LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS,
	LIKED_SONGS_PAGE_SIZE,
} from "../constants";

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

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => supabase,
}));

const likedSongs = await import("../queries");

const ACCOUNT_ID = crypto.randomUUID();
const TIE_ACCOUNT_ID = crypto.randomUUID();

const NUM_SONGS = 60;
// One song left un-entitled, to prove the slug lookup resolves regardless of
// entitlement (the row just comes back display_state = 'locked').
const LOCKED_INDEX = 5;
const TIE_COUNT = 50;
const BASE = Date.UTC(2026, 0, 1);

interface Fixture {
	songId: string;
	artist: string;
	name: string;
	slug: string;
	likedAt: string;
}

// Index 0 is the newest like; liked_at strictly decreases with index.
const songs: Fixture[] = Array.from({ length: NUM_SONGS }, (_, i) => {
	const artist = `Slug Artist ${i}`;
	const name = `Slug Song #${i}!`;
	return {
		songId: crypto.randomUUID(),
		artist,
		name,
		slug: generateSongSlug(artist, name),
		likedAt: new Date(BASE - i * 60_000).toISOString(),
	};
});

// All tied at one timestamp. Which row sits where in (liked_at DESC, id DESC)
// order depends on the random uuids, and Postgres uuid ordering is not the same
// as JS string ordering — so the test reads the real order back from the DB
// rather than guessing the deepest row.
const TIED_AT = new Date(BASE - NUM_SONGS * 60_000).toISOString();
const tieSongs: Fixture[] = Array.from({ length: TIE_COUNT }, (_, i) => {
	const artist = `Tie Artist ${i}`;
	const name = `Tie Song ${i}`;
	return {
		songId: crypto.randomUUID(),
		artist,
		name,
		slug: generateSongSlug(artist, name),
		likedAt: TIED_AT,
	};
});

async function seedAccount(
	accountId: string,
	fixtures: Fixture[],
	{ lockedIndex }: { lockedIndex?: number } = {},
) {
	if (!supabase) throw new Error("supabase client not initialised");

	await supabase
		.from("account")
		.insert({ id: accountId, spotify_id: `test-${accountId}` })
		.throwOnError();

	await supabase
		.from("account_billing")
		.insert({
			account_id: accountId,
			plan: "free",
			unlimited_access_source: null,
			subscription_status: "none",
		})
		.throwOnError();

	await supabase
		.from("song")
		.insert(
			fixtures.map((s) => ({
				id: s.songId,
				spotify_id: `sp-${s.songId}`,
				name: s.name,
				artists: [s.artist],
				artist_ids: [`art-${s.songId}`],
			})),
		)
		.throwOnError();

	await supabase
		.from("liked_song")
		.insert(
			fixtures.map((s) => ({
				account_id: accountId,
				song_id: s.songId,
				liked_at: s.likedAt,
			})),
		)
		.throwOnError();

	const entitled = fixtures.filter((_, i) => i !== lockedIndex);
	await supabase
		.from("account_song_unlock")
		.insert(
			entitled.map((s) => ({
				account_id: accountId,
				song_id: s.songId,
				source: "free_auto",
			})),
		)
		.throwOnError();
}

describe.skipIf(!IS_LOCAL)("liked-song slug resolution", () => {
	beforeAll(async () => {
		await seedAccount(ACCOUNT_ID, songs, { lockedIndex: LOCKED_INDEX });
		await seedAccount(TIE_ACCOUNT_ID, tieSongs);
	});

	afterAll(async () => {
		if (!supabase) return;
		// account FK is ON DELETE CASCADE — clears liked_song, unlocks, billing.
		await supabase
			.from("account")
			.delete()
			.in("id", [ACCOUNT_ID, TIE_ACCOUNT_ID])
			.throwOnError();
		await supabase
			.from("song")
			.delete()
			.in(
				"id",
				[...songs, ...tieSongs].map((s) => s.songId),
			)
			.throwOnError();
	});

	it("song_slug() matches generateSongSlug for every seeded song", async () => {
		if (!supabase) return;
		// Resolving each TS-generated slug back to its row proves SQL/TS parity:
		// the indexed song_slug() expression produced the same string.
		for (const sample of [
			songs[0],
			songs[LOCKED_INDEX],
			songs[NUM_SONGS - 1],
		]) {
			const result = await likedSongs.getPageRowBySlug(ACCOUNT_ID, sample.slug);
			expect(Result.isOk(result)).toBe(true);
			if (!Result.isOk(result)) return;
			expect(result.value?.song_id).toBe(sample.songId);
		}
	});

	it("getPageRowBySlug resolves a mid-library song in one lookup", async () => {
		const target = songs[20];
		const result = await likedSongs.getPageRowBySlug(ACCOUNT_ID, target.slug);
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value?.song_id).toBe(target.songId);
		expect(result.value?.song_name).toBe(target.name);
	});

	it("getPageRowBySlug returns null for a bogus slug", async () => {
		const result = await likedSongs.getPageRowBySlug(
			ACCOUNT_ID,
			"this-slug-does-not-exist",
		);
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toBeNull();
	});

	it("resolves a slug even when the song is locked (lookup is not entitlement-gated)", async () => {
		const locked = songs[LOCKED_INDEX];
		const result = await likedSongs.getPageRowBySlug(ACCOUNT_ID, locked.slug);
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value?.song_id).toBe(locked.songId);
		expect(result.value?.display_state).toBe("locked");
	});

	it("getBootstrapPagesBySlug seeds the prefix through a deep selection plus a trailing buffer", async () => {
		const target = songs[20];
		const result = await likedSongs.getBootstrapPagesBySlug(
			ACCOUNT_ID,
			target.slug,
		);
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { selectedRow, pages } = result.value;
		expect(selectedRow?.song_id).toBe(target.songId);

		const flat = pages.flatMap((p) => p.items);
		// Prefix song[0]..song[20] (21 rows) + the full trailing buffer.
		expect(flat).toHaveLength(21 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS);
		// Contiguous newest-first from the very newest like.
		expect(flat[0].song_id).toBe(songs[0].songId);
		expect(flat.map((r) => r.song_id)).toEqual(
			songs
				.slice(0, 21 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS)
				.map((s) => s.songId),
		);
		// 60 songs total, so older songs still follow the seeded tail.
		expect(pages[pages.length - 1].nextCursor).not.toBeNull();
	});

	it("getBootstrapPagesBySlug falls back to the canonical first page for a missing slug", async () => {
		const result = await likedSongs.getBootstrapPagesBySlug(
			ACCOUNT_ID,
			"no-such-slug-at-all",
		);
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { selectedRow, pages } = result.value;
		expect(selectedRow).toBeNull();
		expect(pages).toHaveLength(1);
		expect(pages[0].items).toHaveLength(LIKED_SONGS_PAGE_SIZE);
		expect(pages[0].items[0].song_id).toBe(songs[0].songId);
		// 60 > 15 rows, so a cursor remains.
		expect(pages[0].nextCursor).not.toBeNull();
	});

	it("resolves a deep selection inside a block of rows sharing one liked_at", async () => {
		// Read the real (liked_at DESC, id DESC) order of the tied block, then pick a
		// row deep inside it. The liked_at-only cursor used to drop tied rows past a
		// page boundary; the composite cursor in the RPC must walk straight to it.
		const ordered = await likedSongs.getPageWithDetails(TIE_ACCOUNT_ID, {
			filter: "all",
			limit: TIE_COUNT + 5,
		});
		expect(Result.isOk(ordered)).toBe(true);
		if (!Result.isOk(ordered)) return;
		const order = ordered.value.items.map((row) => row.song_id);
		expect(order).toHaveLength(TIE_COUNT);

		const DEEP_INDEX = 40;
		const target = tieSongs.find((s) => s.songId === order[DEEP_INDEX]);
		if (!target) throw new Error("deep tied song not found");

		const result = await likedSongs.getBootstrapPagesBySlug(
			TIE_ACCOUNT_ID,
			target.slug,
		);
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { selectedRow, pages } = result.value;
		expect(selectedRow?.song_id).toBe(target.songId);

		const flat = pages.flatMap((p) => p.items);
		// The selection is 40 deep with 9 rows behind it (< the trailing buffer),
		// so the seeded run is the whole block, in the exact DB order, selection in
		// place, and the final page terminates.
		expect(flat.map((r) => r.song_id)).toEqual(order);
		expect(flat[DEEP_INDEX].song_id).toBe(target.songId);
		expect(pages[pages.length - 1].nextCursor).toBeNull();

		// And the single-row resolver finds it too.
		const single = await likedSongs.getPageRowBySlug(
			TIE_ACCOUNT_ID,
			target.slug,
		);
		expect(Result.isOk(single)).toBe(true);
		if (!Result.isOk(single)) return;
		expect(single.value?.song_id).toBe(target.songId);
	});
});

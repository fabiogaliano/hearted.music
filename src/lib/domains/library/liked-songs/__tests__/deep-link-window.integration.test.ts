/**
 * The windowed deep link against real Postgres: get_liked_songs_window_by_slug
 * seeds rows around the linked song, and get_liked_songs_page_newer plus
 * get_liked_songs_page page out from it. Paging up and then down from any
 * window must rebuild the canonical newest-first order with no gap and no
 * duplicate, including across blocks of likes that share one liked_at (the
 * keyset tiebreak on id).
 *
 * Seeds through postgres.js against DATABASE_URL; auto-skipped unless that is
 * the local stack.
 */

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSongSlug } from "@/lib/domains/library/songs/slug";
import { LIKED_SONGS_DEEP_LINK_CONTEXT_ROWS } from "../constants";
import {
	getBootstrapPagesBySlug,
	getNewerPage,
	getPageWithDetails,
	type LikedSongsBootstrapPages,
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
const TAG = `deep-link-window-${ACCOUNT_ID}`;
const ARTIST = "Window Artist";
const LIKED_COUNT = 160;
// Small pages so paging crosses many tied blocks; the app uses
// LIKED_SONGS_PAGE_SIZE.
const PAGE = 7;

// Canonical newest-first song ids, read back from the DB: tied liked_at blocks
// order by id, which only Postgres can say.
const canonical: string[] = [];
const nameBySongId = new Map<string, string>();

beforeAll(async () => {
	if (!IS_LOCAL) return;
	const client = db();
	await client`INSERT INTO account(id, spotify_id) VALUES (${ACCOUNT_ID}, ${`test-${ACCOUNT_ID}`})`;
	await client`
		INSERT INTO account_billing(account_id, plan, subscription_status)
		VALUES (${ACCOUNT_ID}, 'free', 'none')
	`;
	await client`
		INSERT INTO song(id, spotify_id, name, artists, artist_ids)
		SELECT gen_random_uuid(), ${TAG} || '-' || n, 'Window Song ' || n, ${`{"${ARTIST}"}`}::text[], '{art-1}'::text[]
		FROM generate_series(1, ${LIKED_COUNT}) AS n
	`;
	// Blocks of four likes share one liked_at.
	await client`
		INSERT INTO liked_song(account_id, song_id, liked_at)
		SELECT ${ACCOUNT_ID}::uuid, s.id,
			'2026-01-01'::timestamptz - (split_part(s.spotify_id, '-', -1)::int / 4) * interval '1 minute'
		FROM song s WHERE s.spotify_id LIKE ${`${TAG}-%`}
	`;
	// A few unlocked songs, so the window's entitlement-gated columns differ
	// from row to row.
	await client`
		INSERT INTO account_song_unlock(account_id, song_id, source)
		SELECT ${ACCOUNT_ID}::uuid, s.id, 'admin'
		FROM song s
		WHERE s.spotify_id LIKE ${`${TAG}-%`}
			AND split_part(s.spotify_id, '-', -1)::int % 5 = 0
	`;
	const page = await getPageWithDetails(ACCOUNT_ID, {
		filter: "all",
		limit: LIKED_COUNT + 1,
	});
	for (const row of page.unwrap().items) {
		canonical.push(row.song_id);
		nameBySongId.set(row.song_id, row.song_name);
	}
}, 60_000);

afterAll(async () => {
	if (!sql) return;
	await sql`DELETE FROM account WHERE id = ${ACCOUNT_ID}`;
	await sql`DELETE FROM song WHERE spotify_id LIKE ${`${TAG}-%`}`;
	await sql.end();
});

// The slug of the song at a canonical (newest-first) position.
function slugAt(index: number): string {
	return generateSongSlug(ARTIST, nameBySongId.get(canonical[index]) ?? "");
}

async function windowAt(index: number): Promise<LikedSongsBootstrapPages> {
	return (await getBootstrapPagesBySlug(ACCOUNT_ID, slugAt(index))).unwrap();
}

const idsOf = (bootstrap: LikedSongsBootstrapPages) =>
	bootstrap.pages.flatMap((page) => page.items.map((row) => row.song_id));

// Pages up from the window's first page until the newest like, then down from
// its last page until the oldest, the way the client's infinite query does.
async function pageOut(bootstrap: LikedSongsBootstrapPages): Promise<string[]> {
	const ids = idsOf(bootstrap);
	let prevCursor = bootstrap.pages[0].prevCursor;
	while (prevCursor !== null) {
		const page = (
			await getNewerPage(ACCOUNT_ID, {
				cursor: prevCursor,
				limit: PAGE,
				minScore: 0,
			})
		).unwrap();
		ids.unshift(...page.items.map((row) => row.song_id));
		prevCursor = page.prevCursor;
	}
	let nextCursor = bootstrap.pages.at(-1)?.nextCursor ?? null;
	while (nextCursor !== null) {
		const page = (
			await getPageWithDetails(ACCOUNT_ID, {
				filter: "all",
				cursor: nextCursor,
				limit: PAGE,
			})
		).unwrap();
		ids.push(...page.items.map((row) => row.song_id));
		nextCursor = page.nextCursor;
	}
	return ids;
}

describeLocal("deep-link window", () => {
	it("seeds the context rows on each side of a song mid-library", async () => {
		const at = 80;

		const bootstrap = await windowAt(at);

		expect(bootstrap.selectedRow?.song_id).toBe(canonical[at]);
		expect(idsOf(bootstrap)).toEqual(
			canonical.slice(
				at - LIKED_SONGS_DEEP_LINK_CONTEXT_ROWS,
				at + LIKED_SONGS_DEEP_LINK_CONTEXT_ROWS + 1,
			),
		);
		expect(bootstrap.startCursor).not.toBeNull();
		expect(bootstrap.pages[0].prevCursor).not.toBeNull();
		expect(bootstrap.pages.at(-1)?.nextCursor).not.toBeNull();
	});

	it("starts at the newest like for a song at the head", async () => {
		const bootstrap = await windowAt(0);

		expect(bootstrap.selectedRow?.song_id).toBe(canonical[0]);
		expect(idsOf(bootstrap)).toEqual(
			canonical.slice(0, LIKED_SONGS_DEEP_LINK_CONTEXT_ROWS + 1),
		);
		expect(bootstrap.startCursor).toBeNull();
		expect(bootstrap.pages[0].prevCursor).toBeNull();
	});

	it("ends at the oldest like for a song at the tail", async () => {
		const bootstrap = await windowAt(LIKED_COUNT - 1);

		expect(bootstrap.selectedRow?.song_id).toBe(canonical.at(-1));
		expect(idsOf(bootstrap)).toEqual(
			canonical.slice(-(LIKED_SONGS_DEEP_LINK_CONTEXT_ROWS + 1)),
		);
		expect(bootstrap.pages.at(-1)?.nextCursor).toBeNull();
	});

	it("falls back to the first page for a slug the account hasn't liked", async () => {
		const bootstrap = (
			await getBootstrapPagesBySlug(ACCOUNT_ID, "no-such-window-song")
		).unwrap();

		expect(bootstrap.selectedRow).toBeNull();
		expect(bootstrap.startCursor).toBeNull();
		expect(bootstrap.pages[0].prevCursor).toBeNull();
		expect(idsOf(bootstrap)[0]).toBe(canonical[0]);
	});

	it.each([
		["mid-library", 80],
		["at the head", 0],
		["at the tail", LIKED_COUNT - 1],
		[
			"one row past the context from the head",
			LIKED_SONGS_DEEP_LINK_CONTEXT_ROWS + 1,
		],
	])("pages up then down from a window %s to the canonical order, no gaps or duplicates", async (_label, index) => {
		const bootstrap = await windowAt(index);

		expect(await pageOut(bootstrap)).toEqual(canonical);
	});

	it("reads below each page read upwards from that page's next cursor, as a refetch does", async () => {
		const bootstrap = await windowAt(80);
		let prevCursor = bootstrap.pages[0].prevCursor;
		while (prevCursor !== null) {
			const page = (
				await getNewerPage(ACCOUNT_ID, {
					cursor: prevCursor,
					limit: PAGE,
					minScore: 0,
				})
			).unwrap();
			const nextCursor = page.nextCursor;
			if (nextCursor === null) throw new Error("expected rows below");
			const below = (
				await getPageWithDetails(ACCOUNT_ID, {
					filter: "all",
					cursor: nextCursor,
					limit: 1,
				})
			).unwrap();
			// The first row below a page read upwards is the row it was read from.
			const from = canonical.indexOf(page.items.at(-1)?.song_id ?? "") + 1;
			expect(below.items[0]?.song_id).toBe(canonical[from]);
			prevCursor = page.prevCursor;
		}
	});

	it("regression: reads from the newest like below an empty page read upwards (a refetch dropped the newest like)", async () => {
		const newest = (
			await getPageWithDetails(ACCOUNT_ID, { filter: "all", limit: 1 })
		).unwrap().items[0];
		const startOfList = (
			await getNewerPage(ACCOUNT_ID, {
				cursor: `${newest.liked_at}|${newest.id}`,
				limit: PAGE,
				minScore: 0,
			})
		).unwrap();
		expect(startOfList.items).toEqual([]);
		expect(startOfList.prevCursor).toBeNull();
		if (startOfList.nextCursor === null) throw new Error("expected rows below");

		const below = (
			await getPageWithDetails(ACCOUNT_ID, {
				filter: "all",
				cursor: startOfList.nextCursor,
				limit: PAGE,
			})
		).unwrap();

		expect(below.items.map((row) => row.song_id)).toEqual(
			canonical.slice(0, PAGE),
		);
	});

	it("returns the page read's list columns for every row of a window", async () => {
		const bootstrap = await windowAt(80);
		const windowRows = bootstrap.pages.flatMap((page) => page.items);
		const pageRows = new Map(
			(
				await getPageWithDetails(ACCOUNT_ID, {
					filter: "all",
					limit: LIKED_COUNT + 1,
				})
			)
				.unwrap()
				.items.map((row) => [row.id, row]),
		);

		expect(new Set(windowRows.map((row) => row.display_state))).toEqual(
			new Set(["locked", "pending"]),
		);
		for (const row of windowRows) {
			const pageRow = pageRows.get(row.id);
			expect(pageRow).toMatchObject(row);
		}
	});

	it("reproduces the window's first page by reading older from its start cursor", async () => {
		const bootstrap = await windowAt(80);
		if (bootstrap.startCursor === null) throw new Error("expected rows above");

		const page = (
			await getPageWithDetails(ACCOUNT_ID, {
				filter: "all",
				cursor: bootstrap.startCursor,
				limit: bootstrap.pages[0].items.length,
			})
		).unwrap();

		expect(page.items.map((row) => row.song_id)).toEqual(
			bootstrap.pages[0].items.map((row) => row.song_id),
		);
	});
});

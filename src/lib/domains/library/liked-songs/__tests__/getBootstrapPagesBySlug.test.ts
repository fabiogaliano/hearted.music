/**
 * Unit tests for the deep-link bootstrap builder.
 *
 * Mocks the Supabase admin client with in-memory implementations of the two RPCs
 * the builder uses:
 *   - `get_liked_songs_window_by_slug` — resolves the slug to its anchor (the
 *     newest match in `(liked_at DESC, id DESC)` order) and returns up to
 *     `p_rows_before + 1` newer rows, the anchor, and up to `p_rows_after + 1`
 *     older rows. Each `+ 1` tells the builder more rows follow on that side.
 *   - `get_liked_songs_page` — the canonical first page used as the missing-slug
 *     fallback; mirrors the real composite-cursor contract (`p_limit + 1` rows).
 *
 * Behaviour change (2026-10-30): the bootstrap used to seed every row from the
 * newest like through the selected one, so a link to an old song rendered the
 * whole prefix. It now seeds a window around the song, with cursors on both
 * ends for the client to page either way.
 *
 * Keyset order across tied `liked_at`s lives in the RPC and is covered by the
 * integration tests. These exercise the TS layer: anchor location, the window's
 * edges and cursors, rechunking, and the missing-slug fallback.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSongSlug } from "@/lib/domains/library/songs/slug";
import {
	LIKED_SONGS_DEEP_LINK_CONTEXT_ROWS,
	LIKED_SONGS_PAGE_SIZE,
} from "../constants";

type Row = {
	id: string;
	song_id: string;
	song_name: string;
	song_artists: string[];
	liked_at: string;
};

const state = vi.hoisted(() => ({
	rows: [] as Array<{
		id: string;
		song_id: string;
		song_name: string;
		song_artists: string[];
		liked_at: string;
	}>,
	// When set, the RPC fails — exercises error propagation.
	error: null as { code: string; message: string } | null,
	rpcCalls: 0,
}));

function slugOf(row: { song_artists: string[]; song_name: string }): string {
	return generateSongSlug(
		row.song_artists[0] ?? "Unknown Artist",
		row.song_name,
	);
}

function sortNewestFirst(rows: Row[]): Row[] {
	return [...rows].sort((a, b) => {
		if (a.liked_at !== b.liked_at) return a.liked_at < b.liked_at ? 1 : -1;
		return a.id < b.id ? 1 : -1;
	});
}

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		rpc: (
			fn: string,
			params: {
				p_slug?: string;
				p_rows_before?: number;
				p_rows_after?: number;
				p_cursor?: string;
				p_cursor_id?: string;
				p_limit?: number;
			},
		) => {
			state.rpcCalls += 1;
			if (state.error) {
				return Promise.resolve({ data: null, error: state.error });
			}

			const sorted = sortNewestFirst(state.rows);

			if (fn === "get_liked_songs_window_by_slug") {
				const anchorIndex = sorted.findIndex(
					(row) => slugOf(row) === params.p_slug,
				);
				if (anchorIndex === -1) {
					return Promise.resolve({ data: [], error: null });
				}
				const before = (params.p_rows_before ?? 0) + 1;
				const after = (params.p_rows_after ?? 0) + 1;
				const data = sorted.slice(
					Math.max(0, anchorIndex - before),
					anchorIndex + 1 + after,
				);
				return Promise.resolve({ data, error: null });
			}

			// get_liked_songs_page — canonical first-page fallback.
			const cursor = params.p_cursor;
			const cursorId = params.p_cursor_id;
			const visible =
				cursor == null
					? sorted
					: sorted.filter(
							(row) =>
								row.liked_at < cursor ||
								(row.liked_at === cursor &&
									cursorId != null &&
									row.id < cursorId),
						);
			const data = visible.slice(0, (params.p_limit ?? 0) + 1);
			return Promise.resolve({ data, error: null });
		},
	}),
}));

const { getBootstrapPagesBySlug } = await import("../queries");

beforeEach(() => {
	state.error = null;
	state.rpcCalls = 0;
});

const BASE = Date.UTC(2026, 0, 1);
const CONTEXT = LIKED_SONGS_DEEP_LINK_CONTEXT_ROWS;

function makeRows(count: number) {
	return Array.from({ length: count }, (_, i) => ({
		id: `ls-${String(i).padStart(4, "0")}`,
		song_id: `song-${i}`,
		song_name: `Song ${i}`,
		song_artists: [`Artist ${i}`],
		// Strictly decreasing so the newest row sorts first and ISO strings
		// compare in the same order the RPC cursor relies on.
		liked_at: new Date(BASE - i * 60_000).toISOString(),
	}));
}

function slugFor(i: number): string {
	return generateSongSlug(`Artist ${i}`, `Song ${i}`);
}

/** The composite `liked_at|id` cursor the client encodes for a row. */
function cursorOf(row: { liked_at: string; id: string }): string {
	return `${row.liked_at}|${row.id}`;
}

function flatIds(pages: { items: { song_id: string }[] }[]): string[] {
	return pages.flatMap((page) => page.items.map((item) => item.song_id));
}

const songIds = (from: number, to: number) =>
	Array.from({ length: to - from }, (_, i) => `song-${from + i}`);

async function bootstrap(target: number | string) {
	const slug = typeof target === "number" ? slugFor(target) : target;
	return (await getBootstrapPagesBySlug("account-1", slug)).unwrap();
}

describe("getBootstrapPagesBySlug", () => {
	it("seeds a window around a song mid-library, with cursors to page both ways", async () => {
		state.rows = makeRows(300);

		const { selectedRow, pages, startCursor } = await bootstrap(150);

		expect(selectedRow?.song_id).toBe("song-150");
		expect(flatIds(pages)).toEqual(songIds(150 - CONTEXT, 150 + CONTEXT + 1));
		expect(pages.every((p) => p.items.length <= LIKED_SONGS_PAGE_SIZE)).toBe(
			true,
		);
		// Reading older from startCursor reproduces the first row.
		expect(startCursor).toBe(cursorOf(state.rows[150 - CONTEXT - 1]));
		expect(pages[0].prevCursor).toBe(cursorOf(state.rows[150 - CONTEXT]));
		expect(pages[pages.length - 1].nextCursor).toBe(
			cursorOf(state.rows[150 + CONTEXT]),
		);
		expect(state.rpcCalls).toBe(1);
	});

	it("starts at the newest like when the song is at the head", async () => {
		state.rows = makeRows(300);

		const { pages, startCursor } = await bootstrap(0);

		expect(flatIds(pages)).toEqual(songIds(0, CONTEXT + 1));
		expect(startCursor).toBeNull();
		expect(pages[0].prevCursor).toBeNull();
		expect(pages[pages.length - 1].nextCursor).not.toBeNull();
	});

	it("has nothing above when exactly the context rows sit above the song", async () => {
		state.rows = makeRows(300);

		const { pages, startCursor } = await bootstrap(CONTEXT);

		expect(flatIds(pages)[0]).toBe("song-0");
		expect(startCursor).toBeNull();
		expect(pages[0].prevCursor).toBeNull();
	});

	it("keeps a cursor above when one more row sits past the context (the + 1 row)", async () => {
		state.rows = makeRows(300);

		const { pages, startCursor } = await bootstrap(CONTEXT + 1);

		expect(flatIds(pages)[0]).toBe("song-1");
		expect(startCursor).toBe(cursorOf(state.rows[0]));
		expect(pages[0].prevCursor).toBe(cursorOf(state.rows[1]));
	});

	it("terminates the last page when exactly the context rows follow the song", async () => {
		state.rows = makeRows(CONTEXT * 2 + 1);

		const { pages } = await bootstrap(CONTEXT);

		expect(flatIds(pages)).toHaveLength(CONTEXT * 2 + 1);
		expect(pages[pages.length - 1].nextCursor).toBeNull();
	});

	it("terminates the last page when the song is the oldest like", async () => {
		state.rows = makeRows(20);

		const { selectedRow, pages } = await bootstrap(19);

		expect(selectedRow?.song_id).toBe("song-19");
		expect(flatIds(pages)).toEqual(songIds(0, 20));
		expect(pages[pages.length - 1].nextCursor).toBeNull();
	});

	it("returns only the first page and a null selection for a missing slug", async () => {
		state.rows = makeRows(2 * LIKED_SONGS_PAGE_SIZE);

		const { selectedRow, pages, startCursor } =
			await bootstrap("does-not-exist");

		expect(selectedRow).toBeNull();
		expect(startCursor).toBeNull();
		expect(pages).toHaveLength(1);
		expect(flatIds(pages)).toEqual(songIds(0, LIKED_SONGS_PAGE_SIZE));
		expect(pages[0].prevCursor).toBeNull();
		expect(pages[0].nextCursor).toBe(
			cursorOf(state.rows[LIKED_SONGS_PAGE_SIZE - 1]),
		);
		// One window probe (empty) + one canonical-page fallback fetch.
		expect(state.rpcCalls).toBe(2);
	});

	it("resolves a deep match inside a block of rows sharing one liked_at", async () => {
		// Regression for the production bug: a bulk import stamped 76 songs with a
		// single liked_at. The fix is the composite (liked_at, id) ordering, which
		// lives in the RPC. Here 150 rows share one timestamp and the match sits at
		// sorted position 130; the window must still be built around it.
		const TIED_AT = new Date(BASE).toISOString();
		state.rows = Array.from({ length: 150 }, (_, i) => ({
			// Descending ids so song-0 sorts first within the tie, matching the
			// (liked_at DESC, id DESC) order; every row shares liked_at.
			id: `ls-${String(150 - i).padStart(4, "0")}`,
			song_id: `song-${i}`,
			song_name: `Song ${i}`,
			song_artists: [`Artist ${i}`],
			liked_at: TIED_AT,
		}));

		const { selectedRow, pages } = await bootstrap(130);

		expect(selectedRow?.song_id).toBe("song-130");
		expect(flatIds(pages)).toEqual(songIds(130 - CONTEXT, 150));
		expect(state.rpcCalls).toBe(1);
	});

	it("propagates a DB error instead of degrading to an empty/first page", async () => {
		state.rows = makeRows(30);
		state.error = { code: "57014", message: "statement timeout" };

		const result = await getBootstrapPagesBySlug("account-1", slugFor(2));

		// The server fn turns this error into a throw so the route loader can fall
		// back to the normal first-page load — never an empty-library hydration.
		expect(Result.isError(result)).toBe(true);
	});
});

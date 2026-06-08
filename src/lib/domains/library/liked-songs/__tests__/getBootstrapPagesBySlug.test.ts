/**
 * Unit tests for the deep-link bootstrap builder.
 *
 * Mocks the Supabase admin client with an in-memory implementation of the
 * `get_liked_songs_page` RPC that paginates a fixture by `liked_at` (descending,
 * cursor-exclusive) and returns up to `p_limit + 1` rows — exactly the contract
 * `getPageWithDetails` relies on to detect "has more". This exercises the walk,
 * truncation, rechunking, and cursor-termination logic without a live DB.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSongSlug } from "@/lib/utils/slug";
import {
	LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS,
	LIKED_SONGS_PAGE_SIZE,
} from "../constants";

const state = vi.hoisted(() => ({
	rows: [] as Array<{
		song_id: string;
		song_name: string;
		song_artists: string[];
		liked_at: string;
	}>,
	// When set, the RPC fails — exercises error propagation.
	error: null as { code: string; message: string } | null,
	rpcCalls: 0,
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		rpc: (_fn: string, params: { p_cursor?: string; p_limit: number }) => {
			state.rpcCalls += 1;
			if (state.error) {
				return Promise.resolve({ data: null, error: state.error });
			}
			const rows = state.rows;
			const cursor = params.p_cursor;
			let start = 0;
			if (cursor != null) {
				const idx = rows.findIndex((row) => row.liked_at < cursor);
				start = idx === -1 ? rows.length : idx;
			}
			const data = rows.slice(start, start + params.p_limit + 1);
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

function makeRows(count: number) {
	return Array.from({ length: count }, (_, i) => ({
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

function flatIds(pages: { items: { song_id: string }[] }[]): string[] {
	return pages.flatMap((page) => page.items.map((item) => item.song_id));
}

describe("getBootstrapPagesBySlug", () => {
	it("seeds a trailing buffer after a slug found near the top", async () => {
		state.rows = makeRows(200);

		const result = await getBootstrapPagesBySlug("account-1", slugFor(2));
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { selectedRow, pages } = result.value;
		expect(selectedRow?.song_id).toBe("song-2");

		const ids = flatIds(pages);
		// Prefix through the match (song-0..song-2) plus the full trailing buffer.
		expect(ids).toHaveLength(3 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS);
		expect(ids[0]).toBe("song-0");
		// The selection is no longer the last loaded row — older songs follow it.
		expect(ids[ids.length - 1]).toBe(
			`song-${2 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS}`,
		);

		// 200 rows total, so older songs still remain past the seeded tail.
		expect(pages[pages.length - 1].nextCursor).toBe(
			state.rows[2 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS].liked_at,
		);
	});

	it("returns prefix + trailing across multiple client pages for a deep match", async () => {
		state.rows = makeRows(300);

		const result = await getBootstrapPagesBySlug("account-1", slugFor(110));
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { selectedRow, pages } = result.value;
		expect(selectedRow?.song_id).toBe("song-110");

		const ids = flatIds(pages);
		// song-0..song-110 (111) followed by the trailing buffer.
		expect(ids).toHaveLength(111 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS);
		expect(ids[0]).toBe("song-0");
		expect(ids[ids.length - 1]).toBe(
			`song-${110 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS}`,
		);
		expect(pages).toHaveLength(
			Math.ceil(
				(111 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS) / LIKED_SONGS_PAGE_SIZE,
			),
		);

		// In-between pages chain by their last row's liked_at...
		expect(pages[0].nextCursor).toBe(
			state.rows[LIKED_SONGS_PAGE_SIZE - 1].liked_at,
		);
		// ...and the final page still points past the seeded tail (more remain).
		expect(pages[pages.length - 1].nextCursor).toBe(
			state.rows[110 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS].liked_at,
		);
	});

	it("fetches an extra chunk to fill the trailing buffer near a chunk boundary", async () => {
		state.rows = makeRows(300);

		const result = await getBootstrapPagesBySlug("account-1", slugFor(95));
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { selectedRow, pages } = result.value;
		expect(selectedRow?.song_id).toBe("song-95");

		const ids = flatIds(pages);
		// Only 4 trailing rows live in the first 100-row chunk (song-96..song-99),
		// so the walk fetches a second chunk to complete the buffer.
		expect(ids).toHaveLength(96 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS);
		expect(ids[ids.length - 1]).toBe(
			`song-${95 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS}`,
		);
		expect(state.rpcCalls).toBe(2);
		expect(pages[pages.length - 1].nextCursor).toBe(
			state.rows[95 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS].liked_at,
		);
	});

	it("includes only the trailing rows that exist when the match is near the end", async () => {
		state.rows = makeRows(20);

		const result = await getBootstrapPagesBySlug("account-1", slugFor(15));
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { selectedRow, pages } = result.value;
		expect(selectedRow?.song_id).toBe("song-15");

		const ids = flatIds(pages);
		// Selected + only the 4 trailing rows that exist (song-16..song-19),
		// fewer than the full buffer would request.
		expect(ids).toHaveLength(20);
		expect(ids[ids.length - 1]).toBe("song-19");
		// Seeded tail reaches the true end of the library.
		expect(pages[pages.length - 1].nextCursor).toBeNull();
	});

	it("returns only the first page and a null selection for a missing slug", async () => {
		state.rows = makeRows(30);

		const result = await getBootstrapPagesBySlug("account-1", "does-not-exist");
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { selectedRow, pages } = result.value;
		expect(selectedRow).toBeNull();
		expect(pages).toHaveLength(1);
		expect(pages[0].items).toHaveLength(LIKED_SONGS_PAGE_SIZE);
		// Identical to a normal first page: 30 > 15 rows, so a cursor remains.
		expect(pages[0].nextCursor).toBe(
			state.rows[LIKED_SONGS_PAGE_SIZE - 1].liked_at,
		);
	});

	it("terminates the final page with a null cursor when the slug is the oldest song", async () => {
		state.rows = makeRows(20);

		const result = await getBootstrapPagesBySlug("account-1", slugFor(19));
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { selectedRow, pages } = result.value;
		expect(selectedRow?.song_id).toBe("song-19");
		// No rows follow the oldest song, so the seeded run is just the prefix.
		expect(flatIds(pages)).toHaveLength(20);
		expect(pages[pages.length - 1].nextCursor).toBeNull();
	});

	it("propagates a DB error instead of degrading to an empty/first page", async () => {
		state.rows = makeRows(30);
		state.error = { code: "57014", message: "statement timeout" };

		const result = await getBootstrapPagesBySlug("account-1", slugFor(2));

		// The server fn turns this error into a throw so the route loader can fall
		// back to the normal first-page load — never an empty-library hydration.
		expect(Result.isError(result)).toBe(true);
	});

	it("stops at the match without a second bootstrap walk", async () => {
		state.rows = makeRows(500);

		const result = await getBootstrapPagesBySlug("account-1", slugFor(3));
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		expect(result.value.selectedRow?.song_id).toBe("song-3");
		const ids = flatIds(result.value.pages);
		// Prefix song-0..song-3 plus the trailing buffer, all inside the first
		// 100-row fetch — so still a single RPC, no separate guard walk.
		expect(ids).toHaveLength(4 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS);
		expect(ids[ids.length - 1]).toBe(
			`song-${3 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS}`,
		);
		expect(state.rpcCalls).toBe(1);
	});
});

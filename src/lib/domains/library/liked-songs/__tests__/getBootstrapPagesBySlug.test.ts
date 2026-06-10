/**
 * Unit tests for the deep-link bootstrap builder.
 *
 * Mocks the Supabase admin client with in-memory implementations of the two RPCs
 * the builder uses:
 *   - `get_liked_songs_bootstrap_by_slug` — resolves the slug to its anchor (the
 *     newest match in `(liked_at DESC, id DESC)` order) and returns the prefix
 *     from the newest row through the anchor plus up to `p_trailing_limit + 1`
 *     older rows. The `+ 1` is the sentinel the builder reads to decide whether
 *     more songs follow the seeded tail.
 *   - `get_liked_songs_page` — the canonical first page used as the missing-slug
 *     fallback; mirrors the real composite-cursor contract (`p_limit + 1` rows).
 *
 * The SQL-level concerns the old page-walk had to handle in TS — chunk
 * boundaries, stepping a cursor into a block of tied `liked_at`s — now live in
 * the RPC and are covered by slug-resolution.integration.test.ts. These tests
 * exercise the TS layer: anchor location, prefix/trailing slicing, the sentinel,
 * rechunking, and the missing-slug fallback.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSongSlug } from "@/lib/utils/slug";
import {
	LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS,
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
				p_trailing_limit?: number;
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

			if (fn === "get_liked_songs_bootstrap_by_slug") {
				const anchorIndex = sorted.findIndex(
					(row) => slugOf(row) === params.p_slug,
				);
				if (anchorIndex === -1) {
					return Promise.resolve({ data: [], error: null });
				}
				const prefix = sorted.slice(0, anchorIndex + 1);
				// The +1 sentinel: one extra trailing row beyond the requested buffer.
				const trailing = sorted.slice(
					anchorIndex + 1,
					anchorIndex + 1 + (params.p_trailing_limit ?? 0) + 1,
				);
				return Promise.resolve({ data: [...prefix, ...trailing], error: null });
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

/** The composite `liked_at|id` cursor the client now encodes for a row. */
function cursorOf(row: { liked_at: string; id: string }): string {
	return `${row.liked_at}|${row.id}`;
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
			cursorOf(state.rows[2 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS]),
		);
		// One query — no library walk.
		expect(state.rpcCalls).toBe(1);
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

		// In-between pages chain by their last row's composite cursor...
		expect(pages[0].nextCursor).toBe(
			cursorOf(state.rows[LIKED_SONGS_PAGE_SIZE - 1]),
		);
		// ...and the final page still points past the seeded tail (more remain).
		expect(pages[pages.length - 1].nextCursor).toBe(
			cursorOf(state.rows[110 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS]),
		);
		// Still a single RPC even for a deep match — the prefix arrives in one shot.
		expect(state.rpcCalls).toBe(1);
	});

	it("fills the trailing buffer from the single RPC result, no extra round-trips", async () => {
		state.rows = makeRows(300);

		const result = await getBootstrapPagesBySlug("account-1", slugFor(95));
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { selectedRow, pages } = result.value;
		expect(selectedRow?.song_id).toBe("song-95");

		const ids = flatIds(pages);
		expect(ids).toHaveLength(96 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS);
		expect(ids[ids.length - 1]).toBe(
			`song-${95 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS}`,
		);
		// The old page-walk needed a second fetch to cross a 100-row chunk boundary
		// here; the RPC returns prefix + trailing together, so it is always one call.
		expect(state.rpcCalls).toBe(1);
		expect(pages[pages.length - 1].nextCursor).toBe(
			cursorOf(state.rows[95 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS]),
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

	it("terminates the final page when trailing rows exactly fill the buffer", async () => {
		// Exactly LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS older rows follow the match,
		// so the RPC's +1 sentinel never materializes: the tail is the library end.
		state.rows = makeRows(1 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS);

		const result = await getBootstrapPagesBySlug("account-1", slugFor(0));
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { selectedRow, pages } = result.value;
		expect(selectedRow?.song_id).toBe("song-0");

		const ids = flatIds(pages);
		expect(ids).toHaveLength(1 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS);
		expect(pages[pages.length - 1].nextCursor).toBeNull();
	});

	it("keeps a cursor when one more row exists past the buffer (the +1 sentinel)", async () => {
		// One extra row beyond the buffer: the sentinel fires, so the seeded tail is
		// trimmed to the buffer and the final page keeps a non-null cursor.
		state.rows = makeRows(2 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS);

		const result = await getBootstrapPagesBySlug("account-1", slugFor(0));
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { pages } = result.value;
		const ids = flatIds(pages);
		expect(ids).toHaveLength(1 + LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS);
		expect(pages[pages.length - 1].nextCursor).toBe(
			cursorOf(state.rows[LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS]),
		);
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
			cursorOf(state.rows[LIKED_SONGS_PAGE_SIZE - 1]),
		);
		// One bootstrap probe (empty) + one canonical-page fallback fetch.
		expect(state.rpcCalls).toBe(2);
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

	it("resolves a deep match inside a block of rows sharing one liked_at", async () => {
		// Regression for the production bug: a bulk import stamped 76 songs with a
		// single liked_at. The fix is the composite (liked_at, id) ordering, which
		// now lives in the RPC. Here 150 rows share one timestamp and the match sits
		// at sorted position 130; the builder must still seed the prefix through it.
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

		const result = await getBootstrapPagesBySlug("account-1", slugFor(130));
		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { selectedRow, pages } = result.value;
		expect(selectedRow?.song_id).toBe("song-130");

		const ids = flatIds(pages);
		expect(ids[0]).toBe("song-0");
		expect(ids).toContain("song-130");
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

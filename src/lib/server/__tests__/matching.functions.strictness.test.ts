/**
 * Unit tests for the read-time strictness bar in `deriveUndecidedSongs`.
 *
 * Pure-function tests — only @tanstack/react-start is mocked so the module
 * (which defines server functions at import) can be imported at all.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler: () => () => {},
	});
	return {
		createServerFn: builder,
		createMiddleware: () => ({
			server: () => ({}),
			type: () => ({ server: () => ({}) }),
		}),
	};
});

import { deriveUndecidedSongs } from "../matching.functions";

type Row = { song_id: string; playlist_id: string; score: number };

// deriveUndecidedSongs only reads song_id / playlist_id / score.
function rows(...r: Row[]) {
	return r as unknown as Parameters<typeof deriveUndecidedSongs>[0];
}

describe("deriveUndecidedSongs — strictness bar", () => {
	it("drops below-bar pairs from both maxScore and hasUndecided", () => {
		// song-low's only undecided pair (0.4) is below the 0.5 bar → excluded.
		// song-hi has a 0.9 pair above the bar → kept, maxScore 0.9.
		const result = deriveUndecidedSongs(
			rows(
				{ song_id: "song-hi", playlist_id: "pl-1", score: 0.9 },
				{ song_id: "song-low", playlist_id: "pl-1", score: 0.4 },
			),
			[],
			0.5,
		);

		expect(result).toEqual([{ songId: "song-hi", maxScore: 0.9 }]);
	});

	it("maxScore reflects only visible (>= bar) pairs", () => {
		// song-a has a 0.4 (hidden) and a 0.7 (visible) pair → maxScore is 0.7,
		// not 0.4 or some blend of both.
		const result = deriveUndecidedSongs(
			rows(
				{ song_id: "song-a", playlist_id: "pl-1", score: 0.4 },
				{ song_id: "song-a", playlist_id: "pl-2", score: 0.7 },
			),
			[],
			0.5,
		);

		expect(result).toEqual([{ songId: "song-a", maxScore: 0.7 }]);
	});

	it("keeps a song when an above-bar undecided pair survives a decided one", () => {
		// pl-1 (0.9) is decided; pl-2 (0.6) is undecided and above the bar → stays.
		// maxScore accumulates over every visible pair (decided or not), so the
		// decided 0.9 still sets the ordering weight — only hasUndecided cares
		// about the decision state.
		const result = deriveUndecidedSongs(
			rows(
				{ song_id: "song-a", playlist_id: "pl-1", score: 0.9 },
				{ song_id: "song-a", playlist_id: "pl-2", score: 0.6 },
			),
			[{ song_id: "song-a", playlist_id: "pl-1" }],
			0.5,
		);

		expect(result).toEqual([{ songId: "song-a", maxScore: 0.9 }]);
	});

	it("excludes a song whose only undecided pair is below the bar even if a decided pair is above", () => {
		// pl-1 (0.9) is decided (doesn't count); pl-2 (0.4) is undecided but below
		// the bar → no visible undecided pair → song drops out.
		const result = deriveUndecidedSongs(
			rows(
				{ song_id: "song-a", playlist_id: "pl-1", score: 0.9 },
				{ song_id: "song-a", playlist_id: "pl-2", score: 0.4 },
			),
			[{ song_id: "song-a", playlist_id: "pl-1" }],
			0.5,
		);

		expect(result).toEqual([]);
	});

	it("minScore 0 considers every stored pair (the unfiltered pass)", () => {
		const result = deriveUndecidedSongs(
			rows(
				{ song_id: "song-a", playlist_id: "pl-1", score: 0.4 },
				{ song_id: "song-b", playlist_id: "pl-1", score: 0.36 },
			),
			[],
			0,
		);

		expect(result).toHaveLength(2);
		expect(result.map((s) => s.songId).sort()).toEqual(["song-a", "song-b"]);
	});

	it("treats a score exactly at the bar as visible (>=, not >)", () => {
		const result = deriveUndecidedSongs(
			rows({ song_id: "song-a", playlist_id: "pl-1", score: 0.5 }),
			[],
			0.5,
		);

		expect(result).toEqual([{ songId: "song-a", maxScore: 0.5 }]);
	});
});

import { describe, expect, it } from "vitest";
import { deriveSuggestionNextCursor } from "../suggestion-cursor";

type Row = { fitScore: number; modelRank: number; songId: string };

function rows(n: number): Row[] {
	return Array.from({ length: n }, (_, i) => ({
		fitScore: 0.9 - i * 0.01,
		modelRank: i + 1,
		songId: `song-${i + 1}`,
	}));
}

describe("deriveSuggestionNextCursor", () => {
	it("returns null for an empty page", () => {
		expect(deriveSuggestionNextCursor([], 8)).toBeNull();
		expect(deriveSuggestionNextCursor([], 8, 20)).toBeNull();
	});

	it("returns null for a short (partial) page — a short page is always the last", () => {
		expect(deriveSuggestionNextCursor(rows(3), 8, 20)).toBeNull();
		// Even without a total, a page shorter than pageSize signals the end.
		expect(deriveSuggestionNextCursor(rows(5), 8)).toBeNull();
	});

	it("returns a cursor built from the LAST row on a full page (tail: no total)", () => {
		const page = rows(8);
		const cursor = deriveSuggestionNextCursor(page, 8);
		expect(cursor).toEqual({
			fitScore: page[7].fitScore,
			modelRank: page[7].modelRank,
			songId: page[7].songId,
		});
	});

	it("first page: full page with more rows beyond it → cursor", () => {
		const cursor = deriveSuggestionNextCursor(rows(8), 8, 20);
		expect(cursor).not.toBeNull();
		expect(cursor?.songId).toBe("song-8");
	});

	it("first page: full page that already holds the whole (capped) set → null", () => {
		// rows.length (8) >= total (8): the first page is the entire set, no tail.
		expect(deriveSuggestionNextCursor(rows(8), 8, 8)).toBeNull();
	});
});

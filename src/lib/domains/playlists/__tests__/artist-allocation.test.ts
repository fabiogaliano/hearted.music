/**
 * Tests for the balanced artist-pin allocator: even split, remainder
 * redistribution to heavier artists, round-robin interleave, cross-artist
 * dedupe, and budget/empty edge cases.
 */

import { describe, expect, it } from "vitest";
import { allocateArtistPins } from "../artist-allocation";

const pool = (name: string, ...songIds: string[]) => ({ name, songIds });

describe("allocateArtistPins", () => {
	it("splits slots evenly and interleaves round-robin", () => {
		const result = allocateArtistPins(
			[pool("A", "a1", "a2", "a3"), pool("B", "b1", "b2", "b3")],
			4,
		);
		expect(result).toEqual(["a1", "b1", "a2", "b2"]);
	});

	it("redistributes unused quota from light artists to heavy ones", () => {
		// B has one song; its unused share flows back to A instead of leaving
		// empty slots or capping the playlist short.
		const result = allocateArtistPins(
			[pool("A", "a1", "a2", "a3", "a4", "a5"), pool("B", "b1")],
			6,
		);
		expect(result).toEqual(["a1", "b1", "a2", "a3", "a4", "a5"]);
	});

	it("gives the floor remainder to earlier artists, one extra each", () => {
		const result = allocateArtistPins(
			[
				pool("A", "a1", "a2", "a3"),
				pool("B", "b1", "b2", "b3"),
				pool("C", "c1", "c2", "c3"),
			],
			7,
		);
		// 7 slots / 3 artists → 2 each + 1 remainder, which the round-robin walk
		// hands to the first artist.
		expect(result).toEqual(["a1", "b1", "c1", "a2", "b2", "c2", "a3"]);
	});

	it("stops when every pool is exhausted, even with budget left", () => {
		const result = allocateArtistPins([pool("A", "a1"), pool("B", "b1")], 10);
		expect(result).toEqual(["a1", "b1"]);
	});

	it("dedupes a song credited to several selected artists, slot stays with the artist", () => {
		// "shared" is B's most recent song but A already claimed it — B's slot
		// advances to its next unclaimed song rather than being forfeited.
		const result = allocateArtistPins(
			[pool("A", "shared", "a2"), pool("B", "shared", "b2")],
			4,
		);
		expect(result).toEqual(["shared", "b2", "a2"]);
	});

	it("returns empty for zero slots or no artists", () => {
		expect(allocateArtistPins([pool("A", "a1")], 0)).toEqual([]);
		expect(allocateArtistPins([], 10)).toEqual([]);
	});

	it("takes each artist's songs in given (recency) order", () => {
		const result = allocateArtistPins([pool("A", "a1", "a2", "a3")], 2);
		expect(result).toEqual(["a1", "a2"]);
	});
});

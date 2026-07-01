import { describe, expect, it } from "vitest";
import {
	hasNonCanonicalMatchMode,
	modeFromSearch,
	validateMatchSearch,
} from "../match-search";

describe("validateMatchSearch", () => {
	it("returns {} for empty params (playlist mode canonical)", () => {
		expect(validateMatchSearch({})).toEqual({});
	});

	it("returns { mode: 'song' } for mode=song", () => {
		expect(validateMatchSearch({ mode: "song" })).toEqual({
			mode: "song",
		});
	});

	it("returns {} for mode=playlist (normalised away — playlist is the default)", () => {
		expect(validateMatchSearch({ mode: "playlist" })).toEqual({});
	});

	it("returns {} for an unrecognised mode value", () => {
		expect(validateMatchSearch({ mode: "unknown" })).toEqual({});
	});

	it("ignores unrelated params", () => {
		expect(validateMatchSearch({ mode: "song", foo: "bar" })).toEqual({
			mode: "song",
		});
	});
});

describe("modeFromSearch", () => {
	it("returns 'playlist' when no mode is present", () => {
		expect(modeFromSearch({})).toBe("playlist");
	});

	it("returns 'song' when mode is 'song'", () => {
		expect(modeFromSearch({ mode: "song" })).toBe("song");
	});
});

describe("hasNonCanonicalMatchMode", () => {
	it("returns false when mode is absent", () => {
		expect(hasNonCanonicalMatchMode({})).toBe(false);
	});

	it("returns false when mode=song (canonical non-default)", () => {
		expect(hasNonCanonicalMatchMode({ mode: "song" })).toBe(false);
	});

	it("returns true for mode=playlist (redundant — should be normalised away)", () => {
		expect(hasNonCanonicalMatchMode({ mode: "playlist" })).toBe(true);
	});

	it("returns true for an unrecognised mode value", () => {
		expect(hasNonCanonicalMatchMode({ mode: "invalid" })).toBe(true);
	});

	it("returns true for a numeric mode value", () => {
		expect(hasNonCanonicalMatchMode({ mode: 42 })).toBe(true);
	});
});

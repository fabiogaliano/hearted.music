import { describe, expect, it } from "vitest";
import {
	hasNonCanonicalMatchMode,
	modeFromSearch,
	validateMatchSearch,
} from "../match-search";

describe("validateMatchSearch", () => {
	it("returns {} for empty params (song mode canonical)", () => {
		expect(validateMatchSearch({})).toEqual({});
	});

	it("returns { mode: 'playlist' } for mode=playlist", () => {
		expect(validateMatchSearch({ mode: "playlist" })).toEqual({
			mode: "playlist",
		});
	});

	it("returns {} for mode=song (normalised away — song is the default)", () => {
		expect(validateMatchSearch({ mode: "song" })).toEqual({});
	});

	it("returns {} for an unrecognised mode value", () => {
		expect(validateMatchSearch({ mode: "unknown" })).toEqual({});
	});

	it("ignores unrelated params", () => {
		expect(validateMatchSearch({ mode: "playlist", foo: "bar" })).toEqual({
			mode: "playlist",
		});
	});
});

describe("modeFromSearch", () => {
	it("returns 'song' when no mode is present", () => {
		expect(modeFromSearch({})).toBe("song");
	});

	it("returns 'playlist' when mode is 'playlist'", () => {
		expect(modeFromSearch({ mode: "playlist" })).toBe("playlist");
	});
});

describe("hasNonCanonicalMatchMode", () => {
	it("returns false when mode is absent", () => {
		expect(hasNonCanonicalMatchMode({})).toBe(false);
	});

	it("returns false when mode=playlist (canonical non-default)", () => {
		expect(hasNonCanonicalMatchMode({ mode: "playlist" })).toBe(false);
	});

	it("returns true for mode=song (redundant — should be normalised away)", () => {
		expect(hasNonCanonicalMatchMode({ mode: "song" })).toBe(true);
	});

	it("returns true for an unrecognised mode value", () => {
		expect(hasNonCanonicalMatchMode({ mode: "invalid" })).toBe(true);
	});

	it("returns true for a numeric mode value", () => {
		expect(hasNonCanonicalMatchMode({ mode: 42 })).toBe(true);
	});
});

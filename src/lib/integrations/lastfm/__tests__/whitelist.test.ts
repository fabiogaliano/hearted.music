import { describe, expect, it } from "vitest";
import { sanitizeGenrePills } from "../whitelist";

describe("sanitizeGenrePills", () => {
	it("canonicalizes variant spellings before whitelist check", () => {
		// "r&b" canonicalizes to "rnb"; "hip hop" canonicalizes to "hip-hop"
		expect(sanitizeGenrePills(["r&b", "hip hop"])).toEqual(["rnb", "hip-hop"]);
	});

	it("drops strings that are not in the whitelist after canonicalization", () => {
		expect(sanitizeGenrePills(["happy", "rock"])).toEqual(["rock"]);
	});

	it("drops empty strings", () => {
		expect(sanitizeGenrePills(["", "rock"])).toEqual(["rock"]);
	});

	it("drops whitespace-only strings", () => {
		expect(sanitizeGenrePills(["   ", "pop"])).toEqual(["pop"]);
	});

	it("deduplicates canonical forms", () => {
		// "rock" appears twice — only one survives
		expect(sanitizeGenrePills(["rock", "rock"])).toEqual(["rock"]);
	});

	it("deduplicates across variant and canonical form", () => {
		// "hip hop" and "hip-hop" both canonicalize to "hip-hop"
		expect(sanitizeGenrePills(["hip hop", "hip-hop"])).toEqual(["hip-hop"]);
	});

	it("caps the output at 5 genres", () => {
		const sixValid = ["rock", "pop", "jazz", "metal", "folk", "electronic"];
		const result = sanitizeGenrePills(sixValid);
		expect(result).toHaveLength(5);
		expect(result).toEqual(["rock", "pop", "jazz", "metal", "folk"]);
	});

	it("returns an empty array for all-invalid input", () => {
		expect(sanitizeGenrePills(["happy", "sad", "energetic"])).toEqual([]);
	});

	it("trims surrounding whitespace before processing", () => {
		expect(sanitizeGenrePills(["  rock  ", " pop "])).toEqual(["rock", "pop"]);
	});

	it("returns an empty array for empty input", () => {
		expect(sanitizeGenrePills([])).toEqual([]);
	});
});

import { describe, expect, it } from "vitest";
import { hasActiveMatchFilters, normalizeMatchFilters } from "../normalizers";
import type { PlaylistMatchFiltersV1 } from "../types";

describe("normalizeMatchFilters", () => {
	it("returns { version: 1 } for the no-filter default", () => {
		const result = normalizeMatchFilters({ version: 1 });
		expect(result).toEqual({ version: 1 });
	});

	it("omits undefined/inactive filters", () => {
		const result = normalizeMatchFilters({ version: 1 });
		expect("languages" in result).toBe(false);
		expect("releaseYear" in result).toBe(false);
		expect("likedAt" in result).toBe(false);
		expect("vocalGender" in result).toBe(false);
	});

	it("normalizes away empty languages.codes", () => {
		const input: PlaylistMatchFiltersV1 = {
			version: 1,
			languages: { codes: [] },
		};
		const result = normalizeMatchFilters(input);
		expect("languages" in result).toBe(false);
	});

	it("deduplicates language codes preserving first-selection order", () => {
		const input: PlaylistMatchFiltersV1 = {
			version: 1,
			languages: { codes: ["pt", "en", "pt", "fr", "en"] },
		};
		const result = normalizeMatchFilters(input);
		expect(result.languages?.codes).toEqual(["pt", "en", "fr"]);
	});

	it("removes uncataloged codes from languages during normalization", () => {
		const input: PlaylistMatchFiltersV1 = {
			version: 1,
			languages: { codes: ["en", "xx-invalid"] },
		};
		const result = normalizeMatchFilters(input);
		expect(result.languages?.codes).toEqual(["en"]);
	});

	it("removes all languages when only uncataloged codes remain", () => {
		const input: PlaylistMatchFiltersV1 = {
			version: 1,
			languages: { codes: ["xx-invalid"] },
		};
		const result = normalizeMatchFilters(input);
		expect("languages" in result).toBe(false);
	});

	it("preserves releaseYear filter", () => {
		const input: PlaylistMatchFiltersV1 = {
			version: 1,
			releaseYear: { kind: "range", start: 1970, end: 1979 },
		};
		const result = normalizeMatchFilters(input);
		expect(result.releaseYear).toEqual({
			kind: "range",
			start: 1970,
			end: 1979,
		});
	});

	it("preserves likedAt filter", () => {
		const input: PlaylistMatchFiltersV1 = {
			version: 1,
			likedAt: { kind: "before", endDate: "2023-12-31" },
		};
		const result = normalizeMatchFilters(input);
		expect(result.likedAt).toEqual({ kind: "before", endDate: "2023-12-31" });
	});

	it("preserves vocalGender filter", () => {
		const input: PlaylistMatchFiltersV1 = {
			version: 1,
			vocalGender: "female",
		};
		const result = normalizeMatchFilters(input);
		expect(result.vocalGender).toBe("female");
	});
});

describe("hasActiveMatchFilters", () => {
	it("returns false for default no-filter value", () => {
		expect(hasActiveMatchFilters({ version: 1 })).toBe(false);
	});

	it("returns true when any filter is active", () => {
		expect(hasActiveMatchFilters({ version: 1, vocalGender: "male" })).toBe(
			true,
		);
		expect(
			hasActiveMatchFilters({
				version: 1,
				releaseYear: { kind: "exact", year: 2000 },
			}),
		).toBe(true);
		expect(
			hasActiveMatchFilters({ version: 1, languages: { codes: ["en"] } }),
		).toBe(true);
		expect(
			hasActiveMatchFilters({
				version: 1,
				likedAt: { kind: "after", startDate: "2020-01-01" },
			}),
		).toBe(true);
	});
});

import { describe, expect, it } from "vitest";
import {
	activeFilterChipLabels,
	languageLabel,
	likedAtLabel,
	releaseYearLabel,
	vocalGenderLabel,
} from "../labels";

describe("releaseYearLabel", () => {
	it("formats exact year", () => {
		expect(releaseYearLabel({ kind: "exact", year: 1995 })).toBe("1995");
	});

	it("formats before (inclusive upper bound)", () => {
		expect(releaseYearLabel({ kind: "before", end: 1980 })).toBe("≤ 1980");
	});

	it("formats after (inclusive lower bound)", () => {
		expect(releaseYearLabel({ kind: "after", start: 2000 })).toBe("≥ 2000");
	});

	it("formats range", () => {
		expect(releaseYearLabel({ kind: "range", start: 1960, end: 1969 })).toBe(
			"1960–1969",
		);
	});
});

describe("likedAtLabel", () => {
	it("formats before", () => {
		expect(likedAtLabel({ kind: "before", endDate: "2022-12-31" })).toBe(
			"before 2022-12-31",
		);
	});

	it("formats after", () => {
		expect(likedAtLabel({ kind: "after", startDate: "2022-01-01" })).toBe(
			"after 2022-01-01",
		);
	});

	it("formats range with fixed end date", () => {
		expect(
			likedAtLabel({
				kind: "range",
				startDate: "2022-01-01",
				end: { kind: "date", date: "2022-12-31" },
			}),
		).toBe("2022-01-01 – 2022-12-31");
	});

	it("formats range with today end", () => {
		expect(
			likedAtLabel({
				kind: "range",
				startDate: "2022-01-01",
				end: { kind: "today" },
			}),
		).toBe("2022-01-01 – today");
	});
});

describe("vocalGenderLabel", () => {
	it("returns Female", () => {
		expect(vocalGenderLabel("female")).toBe("Female");
	});

	it("returns Male", () => {
		expect(vocalGenderLabel("male")).toBe("Male");
	});
});

describe("languageLabel", () => {
	it("returns label for a known code", () => {
		expect(languageLabel("en")).toBe("English");
		expect(languageLabel("pt")).toBe("Portuguese");
	});

	it("falls back to the code for an unknown code", () => {
		expect(languageLabel("xx-unknown")).toBe("xx-unknown");
	});
});

describe("activeFilterChipLabels", () => {
	it("returns empty array for no-filter default", () => {
		expect(activeFilterChipLabels({ version: 1 })).toEqual([]);
	});

	it("returns labels in fixed type order: languages, releaseYear, likedAt, vocalGender", () => {
		const labels = activeFilterChipLabels({
			version: 1,
			languages: { codes: ["pt", "fr"] },
			releaseYear: { kind: "exact", year: 2000 },
			likedAt: { kind: "before", endDate: "2023-12-31" },
			vocalGender: "female",
		});
		expect(labels).toEqual([
			"Portuguese",
			"French",
			"2000",
			"before 2023-12-31",
			"Female",
		]);
	});

	it("produces one chip per selected language", () => {
		const labels = activeFilterChipLabels({
			version: 1,
			languages: { codes: ["en", "de", "ja"] },
		});
		expect(labels).toEqual(["English", "German", "Japanese"]);
	});
});

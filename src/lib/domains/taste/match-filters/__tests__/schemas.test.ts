import { describe, expect, it } from "vitest";
import { parseSaveMatchFilters, parseStoredMatchFilters } from "../schemas";

describe("parseSaveMatchFilters (strict)", () => {
	it("accepts the minimal no-filter default", () => {
		const result = parseSaveMatchFilters({ version: 1 });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ version: 1 });
		}
	});

	it("rejects unknown top-level keys", () => {
		const result = parseSaveMatchFilters({ version: 1, extra: "field" });
		expect(result.ok).toBe(false);
	});

	it("accepts a valid languages filter", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			languages: { codes: ["en", "pt"] },
		});
		expect(result.ok).toBe(true);
	});

	it("rejects empty languages.codes array", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			languages: { codes: [] },
		});
		expect(result.ok).toBe(false);
	});

	it("rejects uncataloged language code on save", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			languages: { codes: ["xx-invented"] },
		});
		expect(result.ok).toBe(false);
	});

	it("rejects unknown keys inside languages object", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			languages: { codes: ["en"], extra: true },
		});
		expect(result.ok).toBe(false);
	});

	it("accepts releaseYear exact", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "exact", year: 1995 },
		});
		expect(result.ok).toBe(true);
	});

	it("accepts releaseYear before", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "before", end: 1980 },
		});
		expect(result.ok).toBe(true);
	});

	it("accepts releaseYear after", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "after", start: 2000 },
		});
		expect(result.ok).toBe(true);
	});

	it("accepts releaseYear range", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "range", start: 1960, end: 1969 },
		});
		expect(result.ok).toBe(true);
	});

	it("rejects releaseYear range where start > end", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "range", start: 1970, end: 1960 },
		});
		expect(result.ok).toBe(false);
	});

	it("rejects year below minimum", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "exact", year: 999 },
		});
		expect(result.ok).toBe(false);
	});

	it("rejects year above maximum", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "exact", year: 10000 },
		});
		expect(result.ok).toBe(false);
	});

	it("accepts likedAt before", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			likedAt: { kind: "before", endDate: "2022-12-31" },
		});
		expect(result.ok).toBe(true);
	});

	it("accepts likedAt after", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			likedAt: { kind: "after", startDate: "2022-01-01" },
		});
		expect(result.ok).toBe(true);
	});

	it("accepts likedAt range with fixed end date", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			likedAt: {
				kind: "range",
				startDate: "2022-01-01",
				end: { kind: "date", date: "2022-12-31" },
			},
		});
		expect(result.ok).toBe(true);
	});

	it("accepts likedAt range with today end", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			likedAt: {
				kind: "range",
				startDate: "2022-01-01",
				end: { kind: "today" },
			},
		});
		expect(result.ok).toBe(true);
	});

	it("rejects likedAt range where end date is before start date", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			likedAt: {
				kind: "range",
				startDate: "2022-06-01",
				end: { kind: "date", date: "2022-01-01" },
			},
		});
		expect(result.ok).toBe(false);
	});

	it("rejects invalid date string format", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			likedAt: { kind: "before", endDate: "2022/12/31" },
		});
		expect(result.ok).toBe(false);
	});

	it("accepts vocalGender female", () => {
		const result = parseSaveMatchFilters({ version: 1, vocalGender: "female" });
		expect(result.ok).toBe(true);
	});

	it("accepts vocalGender male", () => {
		const result = parseSaveMatchFilters({ version: 1, vocalGender: "male" });
		expect(result.ok).toBe(true);
	});

	it("rejects vocalGender mixed", () => {
		const result = parseSaveMatchFilters({ version: 1, vocalGender: "mixed" });
		expect(result.ok).toBe(false);
	});

	it("rejects version !== 1", () => {
		const result = parseSaveMatchFilters({ version: 2 });
		expect(result.ok).toBe(false);
	});
});

describe("parseStoredMatchFilters (forgiving)", () => {
	it("accepts the minimal no-filter default", () => {
		const result = parseStoredMatchFilters({ version: 1 });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ version: 1 });
			expect(result.wasNormalized).toBe(false);
		}
	});

	it("silently ignores unknown stored top-level keys", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			unknownFutureField: "anything",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ version: 1 });
			expect(result.wasNormalized).toBe(false);
		}
	});

	it("ignores unknown keys inside known objects (languages)", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			languages: { codes: ["en"], unknownProp: true },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.languages).toEqual({ codes: ["en"] });
		}
	});

	it("normalizes whole object to { version: 1 } when a known field has invalid data", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			vocalGender: "mixed",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ version: 1 });
			expect(result.wasNormalized).toBe(true);
		}
	});

	it("normalizes to { version: 1 } when version is invalid", () => {
		const result = parseStoredMatchFilters({ version: 99 });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ version: 1 });
		}
	});

	it("normalizes to { version: 1 } when releaseYear kind is invalid", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			releaseYear: { kind: "decade", year: 1990 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ version: 1 });
		}
	});

	it("normalizes to { version: 1 } when releaseYear range start > end", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			releaseYear: { kind: "range", start: 1970, end: 1960 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ version: 1 });
		}
	});

	it("normalizes to { version: 1 } when likedAt has invalid date format", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			likedAt: { kind: "before", endDate: "not-a-date" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ version: 1 });
		}
	});

	it("normalizes to { version: 1 } when languages.codes is empty", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			languages: { codes: [] },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ version: 1 });
		}
	});

	it("normalizes to { version: 1 } when languages.codes contains uncataloged code", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			languages: { codes: ["xx-invented"] },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ version: 1 });
		}
	});

	it("preserves all valid fields when only unknown keys are present", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			releaseYear: { kind: "exact", year: 2000 },
			vocalGender: "female",
			futureUnknownField: "value",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.releaseYear).toEqual({ kind: "exact", year: 2000 });
			expect(result.value.vocalGender).toBe("female");
		}
	});
});

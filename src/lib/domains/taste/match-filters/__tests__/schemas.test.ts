import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { parseSaveMatchFilters, parseStoredMatchFilters } from "../schemas";

describe("parseSaveMatchFilters (strict)", () => {
	it("accepts the minimal no-filter default", () => {
		const result = parseSaveMatchFilters({ version: 1 });
		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value).toEqual({ version: 1 });
		}
	});

	it("rejects unknown top-level keys", () => {
		const result = parseSaveMatchFilters({ version: 1, extra: "field" });
		expect(Result.isOk(result)).toBe(false);
	});

	it("accepts a valid languages filter", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			languages: { codes: ["en", "pt"] },
		});
		expect(Result.isOk(result)).toBe(true);
	});

	it("rejects empty languages.codes array", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			languages: { codes: [] },
		});
		expect(Result.isOk(result)).toBe(false);
	});

	it("rejects uncataloged language code on save", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			languages: { codes: ["xx-invented"] },
		});
		expect(Result.isOk(result)).toBe(false);
	});

	it("rejects unknown keys inside languages object", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			languages: { codes: ["en"], extra: true },
		});
		expect(Result.isOk(result)).toBe(false);
	});

	it("rejects unknown keys inside releaseYear object", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "exact", year: 2000, label: "x" },
		});
		expect(Result.isOk(result)).toBe(false);
	});

	it("rejects unknown keys inside likedAt object", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			likedAt: { kind: "before", endDate: "2022-12-31", note: "x" },
		});
		expect(Result.isOk(result)).toBe(false);
	});

	it("rejects unknown keys inside the nested likedAt.end object", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			likedAt: {
				kind: "range",
				startDate: "2022-01-01",
				end: { kind: "date", date: "2022-12-31", extra: true },
			},
		});
		expect(Result.isOk(result)).toBe(false);
	});

	it("accepts releaseYear exact", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "exact", year: 1995 },
		});
		expect(Result.isOk(result)).toBe(true);
	});

	it("accepts releaseYear before", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "before", end: 1980 },
		});
		expect(Result.isOk(result)).toBe(true);
	});

	it("accepts releaseYear after", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "after", start: 2000 },
		});
		expect(Result.isOk(result)).toBe(true);
	});

	it("accepts releaseYear range", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "range", start: 1960, end: 1969 },
		});
		expect(Result.isOk(result)).toBe(true);
	});

	it("rejects releaseYear range where start > end", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "range", start: 1970, end: 1960 },
		});
		expect(Result.isOk(result)).toBe(false);
	});

	it("rejects year below minimum", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "exact", year: 999 },
		});
		expect(Result.isOk(result)).toBe(false);
	});

	it("rejects year above maximum", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			releaseYear: { kind: "exact", year: 10000 },
		});
		expect(Result.isOk(result)).toBe(false);
	});

	it("accepts likedAt before", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			likedAt: { kind: "before", endDate: "2022-12-31" },
		});
		expect(Result.isOk(result)).toBe(true);
	});

	it("accepts likedAt after", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			likedAt: { kind: "after", startDate: "2022-01-01" },
		});
		expect(Result.isOk(result)).toBe(true);
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
		expect(Result.isOk(result)).toBe(true);
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
		expect(Result.isOk(result)).toBe(true);
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
		expect(Result.isOk(result)).toBe(false);
	});

	it("rejects invalid date string format", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			likedAt: { kind: "before", endDate: "2022/12/31" },
		});
		expect(Result.isOk(result)).toBe(false);
	});

	it("rejects a well-formed but nonexistent calendar date", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			likedAt: { kind: "before", endDate: "2024-02-31" },
		});
		expect(Result.isOk(result)).toBe(false);
	});

	it("rejects an impossible date inside a range start", () => {
		const result = parseSaveMatchFilters({
			version: 1,
			likedAt: {
				kind: "range",
				startDate: "2023-02-29",
				end: { kind: "date", date: "2023-12-31" },
			},
		});
		expect(Result.isOk(result)).toBe(false);
	});

	it("accepts vocalGender female", () => {
		const result = parseSaveMatchFilters({ version: 1, vocalGender: "female" });
		expect(Result.isOk(result)).toBe(true);
	});

	it("accepts vocalGender male", () => {
		const result = parseSaveMatchFilters({ version: 1, vocalGender: "male" });
		expect(Result.isOk(result)).toBe(true);
	});

	it("rejects vocalGender mixed", () => {
		const result = parseSaveMatchFilters({ version: 1, vocalGender: "mixed" });
		expect(Result.isOk(result)).toBe(false);
	});

	it("rejects version !== 1", () => {
		const result = parseSaveMatchFilters({ version: 2 });
		expect(Result.isOk(result)).toBe(false);
	});
});

describe("parseStoredMatchFilters (forgiving)", () => {
	it("accepts the minimal no-filter default", () => {
		const result = parseStoredMatchFilters({ version: 1 });
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(false);
	});

	it("silently ignores unknown stored top-level keys", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			unknownFutureField: "anything",
		});
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(false);
	});

	it("ignores unknown keys inside known objects (languages)", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			languages: { codes: ["en"], unknownProp: true },
		});
		expect(result.value.languages).toEqual({ codes: ["en"] });
	});

	it("strips (does not reject) unknown keys nested in releaseYear/likedAt", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			releaseYear: { kind: "exact", year: 2000, label: "x" },
			likedAt: {
				kind: "range",
				startDate: "2022-01-01",
				end: { kind: "date", date: "2022-12-31", extra: true },
			},
		});
		// Forgiving path keeps the valid data and quietly drops the extras —
		// not normalized to default, since the known fields are themselves valid.
		expect(result.wasNormalized).toBe(false);
		expect(result.value.releaseYear).toEqual({ kind: "exact", year: 2000 });
		expect(result.value.likedAt).toEqual({
			kind: "range",
			startDate: "2022-01-01",
			end: { kind: "date", date: "2022-12-31" },
		});
	});

	it("normalizes whole object to { version: 1 } when a known field has invalid data", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			vocalGender: "mixed",
		});
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(true);
	});

	it("normalizes to { version: 1 } when version is invalid", () => {
		const result = parseStoredMatchFilters({ version: 99 });
		expect(result.value).toEqual({ version: 1 });
	});

	it("normalizes to { version: 1 } when releaseYear kind is invalid", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			releaseYear: { kind: "decade", year: 1990 },
		});
		expect(result.value).toEqual({ version: 1 });
	});

	it("normalizes to { version: 1 } when releaseYear range start > end", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			releaseYear: { kind: "range", start: 1970, end: 1960 },
		});
		expect(result.value).toEqual({ version: 1 });
	});

	it("normalizes to { version: 1 } when likedAt has invalid date format", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			likedAt: { kind: "before", endDate: "not-a-date" },
		});
		expect(result.value).toEqual({ version: 1 });
	});

	it("normalizes to { version: 1 } when a stored likedAt date is a nonexistent calendar day", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			likedAt: { kind: "after", startDate: "2024-02-31" },
		});
		expect(result.value).toEqual({ version: 1 });
		expect(result.wasNormalized).toBe(true);
	});

	it("normalizes to { version: 1 } when languages.codes is empty", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			languages: { codes: [] },
		});
		expect(result.value).toEqual({ version: 1 });
	});

	it("normalizes to { version: 1 } when languages.codes contains uncataloged code", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			languages: { codes: ["xx-invented"] },
		});
		expect(result.value).toEqual({ version: 1 });
	});

	it("preserves all valid fields when only unknown keys are present", () => {
		const result = parseStoredMatchFilters({
			version: 1,
			releaseYear: { kind: "exact", year: 2000 },
			vocalGender: "female",
			futureUnknownField: "value",
		});
		expect(result.value.releaseYear).toEqual({ kind: "exact", year: 2000 });
		expect(result.value.vocalGender).toBe("female");
	});
});

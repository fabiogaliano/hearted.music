import { describe, expect, it } from "vitest";
import type { SongFilterMetadata } from "../predicates";
import {
	passesAllMatchFilters,
	passesLanguageFilter,
	passesLikedAtFilter,
	passesReleaseYearFilter,
	passesVocalGenderFilter,
} from "../predicates";
import type { PlaylistMatchFiltersV1 } from "../types";

const NOW_MS = new Date("2026-06-21T12:00:00.000Z").getTime();

function meta(overrides: Partial<SongFilterMetadata> = {}): SongFilterMetadata {
	return {
		language: null,
		languageSecondary: null,
		releaseYear: null,
		vocalGender: null,
		likedAt: null,
		...overrides,
	};
}

describe("passesLanguageFilter", () => {
	it("passes when primary language matches", () => {
		expect(passesLanguageFilter(["pt"], meta({ language: "pt" }))).toBe(true);
	});

	it("passes when secondary language matches (OR semantics)", () => {
		expect(
			passesLanguageFilter(
				["fr"],
				meta({ language: "pt", languageSecondary: "fr" }),
			),
		).toBe(true);
	});

	it("passes when any selected code matches primary (OR within codes)", () => {
		expect(passesLanguageFilter(["en", "de"], meta({ language: "de" }))).toBe(
			true,
		);
	});

	it("fails when neither primary nor secondary matches", () => {
		expect(
			passesLanguageFilter(
				["pt"],
				meta({ language: "en", languageSecondary: "de" }),
			),
		).toBe(false);
	});

	it("fails when primary is null and no secondary matches", () => {
		expect(
			passesLanguageFilter(
				["pt"],
				meta({ language: null, languageSecondary: "en" }),
			),
		).toBe(false);
	});

	it("fails when both primary and secondary are null (missing metadata)", () => {
		expect(
			passesLanguageFilter(
				["pt"],
				meta({ language: null, languageSecondary: null }),
			),
		).toBe(false);
	});

	it("passes when primary is null but secondary matches selected code", () => {
		expect(
			passesLanguageFilter(
				["fr"],
				meta({ language: null, languageSecondary: "fr" }),
			),
		).toBe(true);
	});
});

describe("passesReleaseYearFilter", () => {
	it("fails when release_year is null (missing metadata)", () => {
		expect(passesReleaseYearFilter({ kind: "exact", year: 2000 }, null)).toBe(
			false,
		);
	});

	it("exact: passes matching year", () => {
		expect(passesReleaseYearFilter({ kind: "exact", year: 2000 }, 2000)).toBe(
			true,
		);
	});

	it("exact: fails non-matching year", () => {
		expect(passesReleaseYearFilter({ kind: "exact", year: 2000 }, 1999)).toBe(
			false,
		);
	});

	it("before: passes at inclusive boundary", () => {
		expect(passesReleaseYearFilter({ kind: "before", end: 1980 }, 1980)).toBe(
			true,
		);
	});

	it("before: passes below boundary", () => {
		expect(passesReleaseYearFilter({ kind: "before", end: 1980 }, 1970)).toBe(
			true,
		);
	});

	it("before: fails above boundary", () => {
		expect(passesReleaseYearFilter({ kind: "before", end: 1980 }, 1981)).toBe(
			false,
		);
	});

	it("after: passes at inclusive boundary", () => {
		expect(passesReleaseYearFilter({ kind: "after", start: 2000 }, 2000)).toBe(
			true,
		);
	});

	it("after: passes above boundary", () => {
		expect(passesReleaseYearFilter({ kind: "after", start: 2000 }, 2010)).toBe(
			true,
		);
	});

	it("after: fails below boundary", () => {
		expect(passesReleaseYearFilter({ kind: "after", start: 2000 }, 1999)).toBe(
			false,
		);
	});

	it("range: passes at start boundary (inclusive)", () => {
		expect(
			passesReleaseYearFilter({ kind: "range", start: 1960, end: 1969 }, 1960),
		).toBe(true);
	});

	it("range: passes at end boundary (inclusive)", () => {
		expect(
			passesReleaseYearFilter({ kind: "range", start: 1960, end: 1969 }, 1969),
		).toBe(true);
	});

	it("range: passes in the middle", () => {
		expect(
			passesReleaseYearFilter({ kind: "range", start: 1960, end: 1969 }, 1965),
		).toBe(true);
	});

	it("range: fails below start", () => {
		expect(
			passesReleaseYearFilter({ kind: "range", start: 1960, end: 1969 }, 1959),
		).toBe(false);
	});

	it("range: fails above end", () => {
		expect(
			passesReleaseYearFilter({ kind: "range", start: 1960, end: 1969 }, 1970),
		).toBe(false);
	});
});

function msFor(dateStr: string): number {
	return new Date(`${dateStr}T00:00:00.000Z`).getTime();
}

describe("passesLikedAtFilter", () => {
	it("fails when likedAt is null (no active liked row)", () => {
		expect(
			passesLikedAtFilter(
				{ kind: "before", endDate: "2022-12-31" },
				null,
				NOW_MS,
			),
		).toBe(false);
	});

	describe("kind: before — half-open: liked_at < dayAfter(endDate)", () => {
		it("passes before the end date", () => {
			expect(
				passesLikedAtFilter(
					{ kind: "before", endDate: "2022-12-31" },
					msFor("2022-12-30"),
					NOW_MS,
				),
			).toBe(true);
		});

		it("passes at midnight on the end date (start of end day — half-open exclusive is next day)", () => {
			expect(
				passesLikedAtFilter(
					{ kind: "before", endDate: "2022-12-31" },
					msFor("2022-12-31"),
					NOW_MS,
				),
			).toBe(true);
		});

		it("fails at midnight on the day after the end date (exclusive boundary)", () => {
			expect(
				passesLikedAtFilter(
					{ kind: "before", endDate: "2022-12-31" },
					msFor("2023-01-01"),
					NOW_MS,
				),
			).toBe(false);
		});
	});

	describe("kind: after — liked_at >= startDate at 00:00:00Z", () => {
		it("passes at midnight on the start date (inclusive)", () => {
			expect(
				passesLikedAtFilter(
					{ kind: "after", startDate: "2022-01-01" },
					msFor("2022-01-01"),
					NOW_MS,
				),
			).toBe(true);
		});

		it("passes after the start date", () => {
			expect(
				passesLikedAtFilter(
					{ kind: "after", startDate: "2022-01-01" },
					msFor("2022-06-15"),
					NOW_MS,
				),
			).toBe(true);
		});

		it("fails before the start date", () => {
			expect(
				passesLikedAtFilter(
					{ kind: "after", startDate: "2022-01-01" },
					msFor("2021-12-31"),
					NOW_MS,
				),
			).toBe(false);
		});
	});

	describe("kind: range with fixed end date", () => {
		const filter = {
			kind: "range" as const,
			startDate: "2022-01-01",
			end: { kind: "date" as const, date: "2022-12-31" },
		};

		it("passes at midnight on start date (inclusive)", () => {
			expect(passesLikedAtFilter(filter, msFor("2022-01-01"), NOW_MS)).toBe(
				true,
			);
		});

		it("passes at midnight on end date (start of end day — exclusive is next day)", () => {
			expect(passesLikedAtFilter(filter, msFor("2022-12-31"), NOW_MS)).toBe(
				true,
			);
		});

		it("fails at midnight on day after end date (exclusive)", () => {
			expect(passesLikedAtFilter(filter, msFor("2023-01-01"), NOW_MS)).toBe(
				false,
			);
		});

		it("fails before start date", () => {
			expect(passesLikedAtFilter(filter, msFor("2021-12-31"), NOW_MS)).toBe(
				false,
			);
		});
	});

	describe("kind: range with end.kind=today (dynamic)", () => {
		it("passes on current UTC date (today is inclusive — exclusive is tomorrow midnight)", () => {
			const nowOnJune21 = new Date("2026-06-21T10:00:00.000Z").getTime();
			const filter = {
				kind: "range" as const,
				startDate: "2025-01-01",
				end: { kind: "today" as const },
			};
			expect(
				passesLikedAtFilter(filter, msFor("2026-06-21"), nowOnJune21),
			).toBe(true);
		});

		it("fails on the day after today (exclusive upper boundary)", () => {
			const nowOnJune21 = new Date("2026-06-21T10:00:00.000Z").getTime();
			const filter = {
				kind: "range" as const,
				startDate: "2025-01-01",
				end: { kind: "today" as const },
			};
			expect(
				passesLikedAtFilter(filter, msFor("2026-06-22"), nowOnJune21),
			).toBe(false);
		});

		it("resolves today dynamically from nowMs, not from a hardcoded date", () => {
			const jan1 = new Date("2026-01-01T06:00:00.000Z").getTime();
			const filter = {
				kind: "range" as const,
				startDate: "2025-01-01",
				end: { kind: "today" as const },
			};
			expect(passesLikedAtFilter(filter, msFor("2026-01-01"), jan1)).toBe(true);
			expect(passesLikedAtFilter(filter, msFor("2026-01-02"), jan1)).toBe(
				false,
			);
		});

		it("year preset (fixed Jan 1 – Dec 31) is not affected by today boundary", () => {
			const dec31Preset = {
				kind: "range" as const,
				startDate: "2022-01-01",
				end: { kind: "date" as const, date: "2022-12-31" },
			};
			const nowInFuture = new Date("2026-06-21T00:00:00.000Z").getTime();
			expect(
				passesLikedAtFilter(dec31Preset, msFor("2022-12-31"), nowInFuture),
			).toBe(true);
			expect(
				passesLikedAtFilter(dec31Preset, msFor("2023-01-01"), nowInFuture),
			).toBe(false);
		});
	});
});

describe("passesVocalGenderFilter", () => {
	it("passes when vocalGender exactly matches female", () => {
		expect(passesVocalGenderFilter("female", "female")).toBe(true);
	});

	it("passes when vocalGender exactly matches male", () => {
		expect(passesVocalGenderFilter("male", "male")).toBe(true);
	});

	it("fails when vocalGender is mixed", () => {
		expect(passesVocalGenderFilter("female", "mixed")).toBe(false);
		expect(passesVocalGenderFilter("male", "mixed")).toBe(false);
	});

	it("fails when vocalGender is unknown", () => {
		expect(passesVocalGenderFilter("female", "unknown")).toBe(false);
		expect(passesVocalGenderFilter("male", "unknown")).toBe(false);
	});

	it("fails when vocalGender is null (missing metadata)", () => {
		expect(passesVocalGenderFilter("female", null)).toBe(false);
		expect(passesVocalGenderFilter("male", null)).toBe(false);
	});

	it("fails when filter is female but song is male", () => {
		expect(passesVocalGenderFilter("female", "male")).toBe(false);
	});
});

describe("passesAllMatchFilters", () => {
	it("returns true for no-filter default regardless of metadata", () => {
		expect(passesAllMatchFilters({ version: 1 }, meta(), NOW_MS)).toBe(true);
	});

	it("applies AND across all filter types — all must pass", () => {
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			languages: { codes: ["pt"] },
			releaseYear: { kind: "exact", year: 2000 },
			vocalGender: "female",
			likedAt: { kind: "after", startDate: "2022-01-01" },
		};
		const m = meta({
			language: "pt",
			releaseYear: 2000,
			vocalGender: "female",
			likedAt: msFor("2022-06-01"),
		});
		expect(passesAllMatchFilters(filters, m, NOW_MS)).toBe(true);
	});

	it("fails when language filter fails even if all others pass", () => {
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			languages: { codes: ["pt"] },
			vocalGender: "female",
		};
		const m = meta({ language: "en", vocalGender: "female" });
		expect(passesAllMatchFilters(filters, m, NOW_MS)).toBe(false);
	});

	it("fails when release-year filter fails even if all others pass", () => {
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			releaseYear: { kind: "exact", year: 2000 },
			vocalGender: "female",
		};
		const m = meta({ releaseYear: 1999, vocalGender: "female" });
		expect(passesAllMatchFilters(filters, m, NOW_MS)).toBe(false);
	});

	it("fails when vocalGender filter fails even if all others pass", () => {
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			releaseYear: { kind: "exact", year: 2000 },
			vocalGender: "female",
		};
		const m = meta({ releaseYear: 2000, vocalGender: "male" });
		expect(passesAllMatchFilters(filters, m, NOW_MS)).toBe(false);
	});

	it("fails when missing metadata on an active filter (null language)", () => {
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			languages: { codes: ["pt"] },
		};
		expect(
			passesAllMatchFilters(filters, meta({ language: null }), NOW_MS),
		).toBe(false);
	});

	it("fails when missing metadata on release year (null release_year)", () => {
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			releaseYear: { kind: "after", start: 1990 },
		};
		expect(
			passesAllMatchFilters(filters, meta({ releaseYear: null }), NOW_MS),
		).toBe(false);
	});

	it("fails when missing metadata on liked date (no active liked row)", () => {
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			likedAt: { kind: "before", endDate: "2023-12-31" },
		};
		expect(
			passesAllMatchFilters(filters, meta({ likedAt: null }), NOW_MS),
		).toBe(false);
	});
});

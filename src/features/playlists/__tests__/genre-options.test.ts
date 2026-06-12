import { describe, expect, it } from "vitest";
import {
	GENRE_OPTIONS,
	isGenreOption,
	searchGenres,
	suggestQuickPicks,
} from "../genre-options";

describe("GENRE_OPTIONS", () => {
	it("dedupes variant spellings to one canonical option", () => {
		const values = GENRE_OPTIONS.map((o) => o.value);
		// "hip hop" / "hiphop" collapse into "hip-hop"; the raw variants must not
		// surface as their own options.
		expect(values).toContain("hip-hop");
		expect(values).not.toContain("hip hop");
		expect(values).not.toContain("hiphop");
		expect(values).toContain("rnb");
		expect(values).not.toContain("r&b");
	});

	it("has no duplicate canonical values", () => {
		const values = GENRE_OPTIONS.map((o) => o.value);
		expect(new Set(values).size).toBe(values.length);
	});

	it("keeps variant spellings as search aliases of their canonical option", () => {
		const rnb = GENRE_OPTIONS.find((o) => o.value === "rnb");
		expect(rnb?.aliases).toContain("r&b");
	});
});

describe("searchGenres", () => {
	it("ranks exact/prefix matches ahead of substring matches", () => {
		const results = searchGenres("rock").map((o) => o.value);
		expect(results[0]).toBe("rock");
		// A genre that only contains "rock" mid-word ranks below the prefix hits.
		const classicRockIndex = results.indexOf("classic rock");
		expect(results.indexOf("rock")).toBeLessThan(classicRockIndex);
	});

	it("matches a canonical option via a variant-spelling alias", () => {
		const results = searchGenres("r&b").map((o) => o.value);
		expect(results).toContain("rnb");
	});

	it("matches on word boundaries inside multi-word genres", () => {
		const results = searchGenres("bass").map((o) => o.value);
		expect(results).toContain("drum and bass");
	});

	it("excludes already-selected values", () => {
		const exclude = new Set(["rock"]);
		const results = searchGenres("rock", { exclude }).map((o) => o.value);
		expect(results).not.toContain("rock");
	});

	it("returns all options alphabetically for an empty query", () => {
		const results = searchGenres("");
		expect(results.length).toBe(GENRE_OPTIONS.length);
		const values = results.map((o) => o.value);
		expect([...values].sort((a, b) => a.localeCompare(b))).toEqual(values);
	});

	it("respects the limit", () => {
		expect(searchGenres("a", { limit: 5 }).length).toBeLessThanOrEqual(5);
	});

	it("returns nothing for a query that matches no genre", () => {
		expect(searchGenres("zzzznotagenre")).toEqual([]);
	});
});

describe("suggestQuickPicks", () => {
	it("surfaces top library genres when nothing is selected", () => {
		const result = suggestQuickPicks({
			topGenres: ["rock", "pop"],
			selected: [],
		});
		expect(result).toEqual(["rock", "pop"]);
	});

	it("excludes already-selected pills", () => {
		const result = suggestQuickPicks({
			topGenres: ["rock", "pop"],
			selected: ["rock"],
		});
		expect(result).not.toContain("rock");
	});

	it("filters out non-whitelist top genres", () => {
		const result = suggestQuickPicks({
			topGenres: ["definitely-not-a-genre", "pop"],
			selected: [],
		});
		expect(result).toEqual(["pop"]);
	});

	it("leads with genres adjacent to the picks once something is selected", () => {
		// hip-hop has curated neighbors, so suggestions appear even with no library
		// seed — proving the adaptive (neighbor) path runs.
		const result = suggestQuickPicks({ topGenres: [], selected: ["hip-hop"] });
		expect(result.length).toBeGreaterThan(0);
		expect(result).not.toContain("hip-hop");
		expect(result.every(isGenreOption)).toBe(true);
	});

	it("backfills with top library genres when the picks have no neighbors", () => {
		// "christmas" is an isolated node (no curated neighbors), so suggestions
		// can only come from the top-genres backfill — confirming both sources
		// compose without the adjacency list crowding the backfill out.
		const result = suggestQuickPicks({
			topGenres: ["bluegrass", "rock"],
			selected: ["christmas"],
		});
		expect(result).toEqual(["bluegrass", "rock"]);
	});
});

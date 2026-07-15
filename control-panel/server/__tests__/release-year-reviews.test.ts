import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db");

import type { TxRun } from "../db";
import { read, tx } from "../db";
import { HttpError } from "../http-error";
import {
	countReleaseYearBuckets,
	mapRow,
	parseReleaseYearQuery,
	releaseYearReviewsPage,
	revertReleaseYear,
	setReleaseYear,
	validateReleaseYear,
} from "../release-year-reviews";

describe("mapRow → UI shape", () => {
	it("maps snake_case DB columns to the camelCase UI shape", () => {
		const row = mapRow({
			song_id: "song-1",
			song_name: "Bohemian Rhapsody - Remastered 2011",
			artist_label: "Queen",
			album_name: "A Night at the Opera",
			image_url: "https://img/cover.jpg",
			release_year: 1975,
			release_year_checked_at: "2026-06-16T09:00:00Z",
			created_at: "2026-06-15T10:00:00Z",
		});
		expect(row.songId).toBe("song-1");
		expect(row.songName).toBe("Bohemian Rhapsody - Remastered 2011");
		expect(row.artistLabel).toBe("Queen");
		expect(row.albumName).toBe("A Night at the Opera");
		expect(row.releaseYear).toBe(1975);
		expect(row.checkedAt).toBe("2026-06-16T09:00:00Z");
	});

	it("coerces nulls without throwing", () => {
		const row = mapRow({
			song_id: "song-2",
			song_name: "Bare",
			artist_label: null,
			album_name: null,
			image_url: null,
			release_year: null,
			release_year_checked_at: null,
			created_at: "2026-06-15T10:00:00Z",
		});
		expect(row.artistLabel).toBe("");
		expect(row.albumName).toBeNull();
		expect(row.imageUrl).toBeNull();
		expect(row.releaseYear).toBeNull();
		expect(row.checkedAt).toBeNull();
	});
});

describe("releaseYearReviewsPage → filter semantics", () => {
	function captureSql(): { queries: string[]; params: unknown[][] } {
		const queries: string[] = [];
		const params: unknown[][] = [];
		vi.mocked(read).mockImplementation((async (text: string, p: unknown[] = []) => {
			queries.push(text);
			params.push(p);
			// The count read runs first; return a numeric total so the page shape holds.
			if (/count\(\*\) as total/.test(text)) return [{ total: "0" }];
			return [];
		}) as typeof read);
		return { queries, params };
	}

	function url(search: string): URL {
		return new URL(`https://panel.test/api/release-year-reviews${search}`);
	}

	beforeEach(() => vi.clearAllMocks());

	it("separates pending (actively liked + never checked) from unresolved manual work", async () => {
		const { queries } = captureSql();

		await releaseYearReviewsPage(url("?filter=pending"));
		// queries[0] is the count, queries[1] is the row page — both carry the WHERE.
		expect(queries[1]).toMatch(
			/release_year is null and s\.release_year_checked_at is null and exists \(/,
		);
		expect(queries[1]).toMatch(/from public\.liked_song ls/);
	});

	it("selects the checked-or-orphaned predicate for unresolved", async () => {
		const { queries } = captureSql();
		await releaseYearReviewsPage(url("?filter=unresolved"));
		expect(queries[1]).toMatch(
			/release_year is null and \(s\.release_year_checked_at is not null or not exists \(/,
		);
	});

	it("selects resolved rows for the set bucket", async () => {
		const { queries } = captureSql();
		await releaseYearReviewsPage(url("?filter=set"));
		expect(queries[1]).toMatch(/release_year is not null/);
	});

	it("defaults to the unresolved (manual-entry) bucket", async () => {
		const { queries } = captureSql();
		await releaseYearReviewsPage(url(""));
		expect(queries[1]).toMatch(/release_year_checked_at is not null or not exists/);
	});

	it("binds an escaped search pattern against name and artists", async () => {
		const { queries, params } = captureSql();
		await releaseYearReviewsPage(url("?q=oa%25sis"));
		expect(queries[1]).toMatch(/s\.name ilike \$1 or array_to_string\(s\.artists/);
		expect(params[1]?.[0]).toBe("%oa\\%sis%");
	});

	it("applies a year range only for the set bucket", async () => {
		const { queries, params } = captureSql();
		await releaseYearReviewsPage(url("?filter=set&yearFrom=1990&yearTo=1999"));
		expect(queries[1]).toMatch(/s\.release_year >= \$1/);
		expect(queries[1]).toMatch(/s\.release_year <= \$2/);
		expect(params[1]?.slice(0, 2)).toEqual([1990, 1999]);
	});

	it("ignores a year range outside the set bucket", () => {
		const parsed = parseReleaseYearQuery(
			url("?filter=unresolved&yearFrom=1990&yearTo=1999"),
		);
		expect(parsed.yearFrom).toBeNull();
		expect(parsed.yearTo).toBeNull();
	});

	it("flips the order direction on the bucket time column", async () => {
		const { queries } = captureSql();
		await releaseYearReviewsPage(url("?filter=set&order=oldest"));
		expect(queries[1]).toMatch(/order by s\.updated_at asc/);
		await releaseYearReviewsPage(url("?filter=set"));
		expect(queries[3]).toMatch(/order by s\.updated_at desc/);
	});
});

describe("countReleaseYearBuckets", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns both year-less buckets as numbers", async () => {
		vi.mocked(read).mockResolvedValue([{ pending: "7", unresolved: "3" }]);
		const counts = await countReleaseYearBuckets();
		expect(counts).toEqual({ pending: 7, unresolved: 3 });
		expect(vi.mocked(read).mock.calls[0]?.[0]).toMatch(/from public\.liked_song ls/);
	});
});

describe("validateReleaseYear", () => {
	it("accepts a plausible 4-digit year (number or string)", () => {
		expect(validateReleaseYear(2019)).toBe(2019);
		expect(validateReleaseYear("1975")).toBe(1975);
		expect(validateReleaseYear(" 2003 ")).toBe(2003);
	});

	it("rejects empty / missing input", () => {
		expect(() => validateReleaseYear("")).toThrow(/required/i);
		expect(() => validateReleaseYear("   ")).toThrow(/required/i);
		expect(() => validateReleaseYear(null)).toThrow(/required/i);
		expect(() => validateReleaseYear(undefined)).toThrow(/required/i);
	});

	it("rejects non-integers and non-numeric input", () => {
		expect(() => validateReleaseYear("19a5")).toThrow(/whole number/i);
		expect(() => validateReleaseYear(1975.5)).toThrow(/whole number/i);
	});

	it("rejects years outside the sane range", () => {
		expect(() => validateReleaseYear(1800)).toThrow(/between/i);
		expect(() => validateReleaseYear(3000)).toThrow(/between/i);
	});

	it("rejects invalid input as a 400 HttpError", () => {
		for (const bad of ["", "19a5", 1975.5, 1800]) {
			let caught: unknown;
			try {
				validateReleaseYear(bad);
			} catch (err) {
				caught = err;
			}
			expect(caught).toBeInstanceOf(HttpError);
			expect((caught as HttpError).status).toBe(400);
		}
	});
});

describe("setReleaseYear", () => {
	let queries: string[];
	let params: unknown[][];

	// The write first reads the prior value (for update), then updates. `before`
	// is what the SELECT returns; an empty array means the song is missing.
	function stubTx(before: Array<{ release_year: number | null }>) {
		queries = [];
		params = [];
		vi.mocked(tx).mockImplementation((async (
			fn: (run: TxRun) => Promise<unknown>,
		) => {
			const run: TxRun = (async (text: string, p: unknown[] = []) => {
				queries.push(text);
				params.push(p);
				if (/select release_year/.test(text)) return before;
				return [];
			}) as TxRun;
			return fn(run);
		}) as typeof tx);
	}

	beforeEach(() => vi.clearAllMocks());

	it("writes the validated year and returns the previous value", async () => {
		stubTx([{ release_year: 1990 }]);

		const result = await setReleaseYear("song-1", "2019");

		expect(result).toEqual({
			ok: true,
			songId: "song-1",
			releaseYear: 2019,
			previousYear: 1990,
		});
		const update = queries.find((q) => /update public\.song/.test(q));
		expect(update).toMatch(/set release_year = \$2/);
		expect(update).toMatch(/where id = \$1/);
		const updateParams =
			params[queries.findIndex((q) => /update public\.song/.test(q))];
		expect(updateParams).toEqual(["song-1", 2019]);
	});

	it("reports a null previous value when the song was unresolved", async () => {
		stubTx([{ release_year: null }]);
		const result = await setReleaseYear("song-1", "2019");
		expect(result.previousYear).toBeNull();
	});

	it("throws a 404 HttpError when the song does not exist (no row read)", async () => {
		stubTx([]);
		await expect(setReleaseYear("missing", 2019)).rejects.toThrow(
			/not found/i,
		);
		const caught = await setReleaseYear("missing", 2019).catch(
			(err: unknown) => err,
		);
		expect(caught).toBeInstanceOf(HttpError);
		expect((caught as HttpError).status).toBe(404);
	});

	it("validates before touching the database", async () => {
		stubTx([{ release_year: 1990 }]);
		await expect(setReleaseYear("song-1", "nope")).rejects.toThrow();
		expect(tx).not.toHaveBeenCalled();
	});
});

describe("revertReleaseYear", () => {
	let queries: string[];

	// `current` is what the guarded SELECT returns for the song's present year.
	function stubTx(current: Array<{ release_year: number | null }>) {
		queries = [];
		vi.mocked(tx).mockImplementation((async (
			fn: (run: TxRun) => Promise<unknown>,
		) => {
			const run: TxRun = (async (text: string) => {
				queries.push(text);
				if (/select release_year/.test(text)) return current;
				return [{ id: "song-1" }];
			}) as TxRun;
			return fn(run);
		}) as typeof tx);
	}

	beforeEach(() => vi.clearAllMocks());

	it("restores the previous year when the current value still matches", async () => {
		stubTx([{ release_year: 2019 }]);
		const result = await revertReleaseYear("song-1", 2019, 1990);
		expect(result).toEqual({ ok: true, songId: "song-1", releaseYear: 1990 });
		expect(queries.some((q) => /update public\.song/.test(q))).toBe(true);
	});

	it("409s without writing when the year changed since the run", async () => {
		stubTx([{ release_year: 2024 }]);
		const caught = await revertReleaseYear("song-1", 2019, 1990).catch(
			(err: unknown) => err,
		);
		expect(caught).toBeInstanceOf(HttpError);
		expect((caught as HttpError).status).toBe(409);
		expect(queries.some((q) => /update public\.song/.test(q))).toBe(false);
	});

	it("404s when the song is gone", async () => {
		stubTx([]);
		const caught = await revertReleaseYear("song-1", 2019, 1990).catch(
			(err: unknown) => err,
		);
		expect((caught as HttpError).status).toBe(404);
	});
});

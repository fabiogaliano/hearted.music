import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db");

import type { TxRun } from "../db";
import { read, tx } from "../db";
import { HttpError } from "../http-error";
import {
	countReleaseYearBuckets,
	listReleaseYearReviews,
	mapRow,
	type ReleaseYearFilter,
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

describe("listReleaseYearReviews → filter semantics", () => {
	function captureSql(): { queries: string[] } {
		const queries: string[] = [];
		vi.mocked(read).mockImplementation((async (text: string) => {
			queries.push(text);
			return [];
		}) as typeof read);
		return { queries };
	}

	beforeEach(() => vi.clearAllMocks());

	it("separates pending (actively liked + never checked) from unresolved manual work", async () => {
		const { queries } = captureSql();

		await listReleaseYearReviews("pending");
		expect(queries[0]).toMatch(
			/release_year is null and s\.release_year_checked_at is null and exists \(/,
		);
		expect(queries[0]).toMatch(/from public\.liked_song ls/);

		await listReleaseYearReviews("unresolved");
		expect(queries[1]).toMatch(
			/release_year is null and \(s\.release_year_checked_at is not null or not exists \(/,
		);
		expect(queries[1]).toMatch(/from public\.liked_song ls/);

		await listReleaseYearReviews("set");
		expect(queries[2]).toMatch(/release_year is not null/);
	});

	it("defaults to the unresolved (manual-entry) bucket", async () => {
		const { queries } = captureSql();
		await listReleaseYearReviews();
		expect(queries[0]).toMatch(/release_year_checked_at is not null or not exists/);
	});

	it("admits exactly the three known filters", () => {
		const filters: ReleaseYearFilter[] = ["pending", "unresolved", "set"];
		expect(filters).toHaveLength(3);
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

	function stubTx(updateReturns: Array<{ id: string }>) {
		queries = [];
		params = [];
		vi.mocked(tx).mockImplementation((async (
			fn: (run: TxRun) => Promise<unknown>,
		) => {
			const run: TxRun = (async (text: string, p: unknown[] = []) => {
				queries.push(text);
				params.push(p);
				if (/update public\.song/.test(text)) return updateReturns;
				return [];
			}) as TxRun;
			return fn(run);
		}) as typeof tx);
	}

	beforeEach(() => vi.clearAllMocks());

	it("writes the validated year and returns the result", async () => {
		stubTx([{ id: "song-1" }]);

		const result = await setReleaseYear("song-1", "2019");

		expect(result).toEqual({ ok: true, songId: "song-1", releaseYear: 2019 });
		const update = queries.find((q) => /update public\.song/.test(q));
		expect(update).toMatch(/set release_year = \$2/);
		expect(update).toMatch(/where id = \$1/);
		expect(params[0]).toEqual(["song-1", 2019]);
	});

	it("throws a 404 HttpError when the song does not exist (no row updated)", async () => {
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
		stubTx([{ id: "song-1" }]);
		await expect(setReleaseYear("song-1", "nope")).rejects.toThrow();
		expect(tx).not.toHaveBeenCalled();
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db");

import type { TxRun } from "../db";
import { read, tx } from "../db";
import { HttpError } from "../http-error";
import {
	mapGroupRow,
	releaseYearGroupsPage,
	setReleaseYearForAlbum,
	validateAlbumId,
	yearCandidatesForAlbums,
} from "../release-year-groups";

function url(search: string): URL {
	return new URL(`https://panel.test/api/release-year-reviews/groups${search}`);
}

describe("mapGroupRow → UI shape", () => {
	const base = {
		album_id: "4dUYpuk18NdNVXQLUVmGAG",
		album_name: "Chillhop Essentials Summer 2017",
		artist_label: "Aso, Middle School, Aviino",
		artist_count: "17",
		image_url: "https://img/cover.jpg",
		song_count: "23",
		first_created_at: "2026-06-15T10:00:00Z",
	};

	it("parses json_agg returned as text by the type-less pooler driver", () => {
		const row = mapGroupRow({
			...base,
			songs: JSON.stringify([
				{
					songId: "s1",
					songName: "Luv",
					artistLabel: "Aso",
					imageUrl: "https://img/1.jpg",
				},
				{ songId: "s2", songName: "Montara", artistLabel: null, imageUrl: null },
			]),
		});
		expect(row.albumId).toBe("4dUYpuk18NdNVXQLUVmGAG");
		expect(row.songCount).toBe(23);
		expect(row.artistCount).toBe(17);
		expect(row.songs).toEqual([
			{
				songId: "s1",
				songName: "Luv",
				artistLabel: "Aso",
				imageUrl: "https://img/1.jpg",
			},
			{ songId: "s2", songName: "Montara", artistLabel: "", imageUrl: null },
		]);
	});

	it("accepts songs already parsed to an array", () => {
		const row = mapGroupRow({
			...base,
			songs: [
				{
					songId: "s1",
					songName: "Luv",
					artistLabel: "Aso",
					imageUrl: null,
				},
			],
		});
		expect(row.songs).toEqual([
			{ songId: "s1", songName: "Luv", artistLabel: "Aso", imageUrl: null },
		]);
	});
});

describe("releaseYearGroupsPage → grouping semantics", () => {
	function captureSql(): { queries: string[]; params: unknown[][] } {
		const queries: string[] = [];
		const params: unknown[][] = [];
		vi.mocked(read).mockImplementation((async (
			text: string,
			p: unknown[] = [],
		) => {
			queries.push(text);
			params.push(p);
			if (/as groups/.test(text)) return [{ groups: "0", songs: "0" }];
			return [];
		}) as typeof read);
		return { queries, params };
	}

	beforeEach(() => vi.clearAllMocks());

	it("groups the unresolved bucket by album and orders biggest groups first", async () => {
		const { queries } = captureSql();
		await releaseYearGroupsPage(url(""));
		const rows = queries.find((q) => /json_agg/.test(q));
		expect(rows).toBeDefined();
		expect(rows).toMatch(/group by s\.album_id/);
		expect(rows).toMatch(/release_year is null/);
		expect(rows).toMatch(/album_id is not null/);
		expect(rows).toMatch(/order by count\(\*\) desc/);
	});

	it("matches the whole group when any member song matches the search", async () => {
		const { queries, params } = captureSql();
		await releaseYearGroupsPage(url("?q=montara"));
		for (const q of queries) {
			expect(q).toMatch(/having bool_or/);
			expect(q).toMatch(/s\.name ilike \$1/);
		}
		expect(params[0]?.[0]).toBe("%montara%");
	});

	it("reports both group and song totals", async () => {
		vi.mocked(read).mockImplementation((async (text: string) => {
			if (/as groups/.test(text)) return [{ groups: "606", songs: "1823" }];
			return [];
		}) as typeof read);
		const page = await releaseYearGroupsPage(url(""));
		expect(page.total).toBe(606);
		expect(page.songTotal).toBe(1823);
	});
});

describe("validateAlbumId", () => {
	it("accepts a Spotify base62 album id", () => {
		expect(validateAlbumId("4dUYpuk18NdNVXQLUVmGAG")).toBe(
			"4dUYpuk18NdNVXQLUVmGAG",
		);
	});

	it("rejects ids with separators or SQL-adjacent characters", () => {
		for (const bad of ["", "abc", "4dUYpuk18NdNVXQLUVmGAG'; --", "a b c d e f g h i j"]) {
			expect(() => validateAlbumId(bad)).toThrow(HttpError);
		}
	});
});

describe("setReleaseYearForAlbum", () => {
	let queries: string[];
	let params: unknown[][];

	function stubTx(members: Array<{ id: string; album_name: string | null }>) {
		queries = [];
		params = [];
		vi.mocked(tx).mockImplementation((async (
			fn: (run: TxRun) => Promise<unknown>,
		) => {
			const run: TxRun = (async (text: string, p: unknown[] = []) => {
				queries.push(text);
				params.push(p);
				if (/select id, album_name/.test(text)) return members;
				return [];
			}) as TxRun;
			return fn(run);
		}) as typeof tx);
	}

	beforeEach(() => vi.clearAllMocks());

	it("writes the year to every still-year-less song of the album", async () => {
		stubTx([
			{ id: "s1", album_name: "Chillhop Essentials Summer 2017" },
			{ id: "s2", album_name: "Chillhop Essentials Summer 2017" },
			{ id: "s3", album_name: "Chillhop Essentials Summer 2017" },
		]);
		const result = await setReleaseYearForAlbum("4dUYpuk18NdNVXQLUVmGAG", "2017");
		expect(result).toEqual({
			ok: true,
			albumId: "4dUYpuk18NdNVXQLUVmGAG",
			releaseYear: 2017,
			songCount: 3,
			albumName: "Chillhop Essentials Summer 2017",
		});
		const update = queries.find((q) => /update public\.song/.test(q));
		// Only null years are touched — a member that already has a year keeps it.
		expect(update).toMatch(/release_year is null/);
		expect(update).toMatch(/where album_id = \$1/);
		const updateParams =
			params[queries.findIndex((q) => /update public\.song/.test(q))];
		expect(updateParams).toEqual(["4dUYpuk18NdNVXQLUVmGAG", 2017]);
	});

	it("404s when the album has no year-less songs left", async () => {
		stubTx([]);
		const caught = await setReleaseYearForAlbum(
			"4dUYpuk18NdNVXQLUVmGAG",
			2017,
		).catch((err: unknown) => err);
		expect(caught).toBeInstanceOf(HttpError);
		expect((caught as HttpError).status).toBe(404);
	});

	it("validates the year and album id before touching the database", async () => {
		stubTx([{ id: "s1", album_name: null }]);
		await expect(
			setReleaseYearForAlbum("4dUYpuk18NdNVXQLUVmGAG", "nope"),
		).rejects.toThrow();
		await expect(setReleaseYearForAlbum("bad id!", 2017)).rejects.toThrow();
		expect(tx).not.toHaveBeenCalled();
	});
});

describe("yearCandidatesForAlbums", () => {
	beforeEach(() => vi.clearAllMocks());

	it("rejects a missing or oversized id list", async () => {
		await expect(yearCandidatesForAlbums(undefined)).rejects.toThrow(
			/albumIds/,
		);
		await expect(yearCandidatesForAlbums([])).rejects.toThrow(/albumIds/);
		const tooMany = Array.from({ length: 201 }, (_, i) => `album${i}xxxx`);
		await expect(yearCandidatesForAlbums(tooMany)).rejects.toThrow(/at most/i);
	});

	it("fetches candidates for albums using their prod metadata", async () => {
		vi.mocked(read).mockResolvedValue([
			{
				album_id: "4dUYpuk18NdNVXQLUVmGAG",
				album_name: "A Night at the Opera",
				artist_label: "Queen",
				artist_count: "1",
			},
		] as never);
		const fetchImpl = vi.fn(async () =>
			new Response(
				JSON.stringify({
					results: [
						{
							collectionName: "A Night at the Opera",
							artistName: "Queen",
							releaseDate: "1975-11-21T08:00:00Z",
						},
					],
				}),
				{ status: 200 },
			),
		);
		const result = await yearCandidatesForAlbums(
			["4dUYpuk18NdNVXQLUVmGAG"],
			fetchImpl as never,
		);
		expect(result.throttled).toBe(false);
		expect(result.remaining).toEqual([]);
		expect(
			result.candidates["4dUYpuk18NdNVXQLUVmGAG"]?.candidates[0],
		).toMatchObject({ source: "itunes", year: 1975 });
		// The single-artist group searches "<artist> <album>".
		const calledUrl = String((fetchImpl.mock.calls[0] as unknown[])[0]);
		expect(calledUrl).toContain("term=Queen+A+Night+at+the+Opera");
	});

	it("stops the sweep and reports throttling on an upstream failure", async () => {
		vi.mocked(read).mockResolvedValue([
			{
				album_id: "aaaaaaaaaaaaaaaaaaaaaa",
				album_name: "First",
				artist_label: "A",
				artist_count: "1",
			},
			{
				album_id: "bbbbbbbbbbbbbbbbbbbbbb",
				album_name: "Second",
				artist_label: "B",
				artist_count: "1",
			},
		] as never);
		const fetchImpl = vi.fn(async () => {
			throw new Error("429");
		});
		const result = await yearCandidatesForAlbums(
			["aaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbb"],
			fetchImpl as never,
		);
		expect(result.throttled).toBe(true);
		expect(result.remaining).toEqual([
			"aaaaaaaaaaaaaaaaaaaaaa",
			"bbbbbbbbbbbbbbbbbbbbbb",
		]);
		expect(result.candidates).toEqual({});
	});

	it("searches compilations by album name alone", async () => {
		vi.mocked(read).mockResolvedValue([
			{
				album_id: "4dUYpuk18NdNVXQLUVmGAG",
				album_name: "Chillhop Essentials Summer 2017",
				artist_label: "Aso, Middle School",
				artist_count: "17",
			},
		] as never);
		const fetchImpl = vi.fn(async (input: string) =>
			new Response(
				JSON.stringify(
					String(input).includes("itunes") ? { results: [] } : { data: [] },
				),
				{ status: 200 },
			),
		);
		await yearCandidatesForAlbums(["4dUYpuk18NdNVXQLUVmGAG"], fetchImpl as never);
		const calledUrl = String(fetchImpl.mock.calls[0]?.[0]);
		expect(calledUrl).toContain("term=Chillhop+Essentials+Summer+2017");
		expect(calledUrl).not.toContain("Aso");
	});
});

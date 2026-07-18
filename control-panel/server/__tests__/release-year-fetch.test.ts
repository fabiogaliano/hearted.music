import { describe, expect, it, vi } from "vitest";

import { HttpError } from "../http-error";
import {
	fetchYearCandidates,
	type YearFetchQuery,
} from "../release-year-fetch";

const QUERY: YearFetchQuery = {
	albumName: "A Night at the Opera",
	artistName: "Queen",
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const ITUNES_HIT = {
	collectionName: "A Night at the Opera",
	artistName: "Queen",
	releaseDate: "1975-11-21T08:00:00Z",
};

describe("fetchYearCandidates", () => {
	it("ranks the closest iTunes album match first and extracts the year", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				results: [
					{
						collectionName: "A Night at the Opera (Karaoke Versions)",
						artistName: "Karaoke Crew",
						releaseDate: "2011-01-01T08:00:00Z",
					},
					ITUNES_HIT,
				],
			}),
		);
		const candidates = await fetchYearCandidates(QUERY, fetchImpl as never);
		expect(candidates[0]?.year).toBe(1975);
		expect(candidates[0]?.source).toBe("itunes");
		expect(candidates[0]?.releaseDate).toBe("1975-11-21T08:00:00Z");
		expect(candidates[0]?.similarity).toBeGreaterThan(
			candidates[1]?.similarity ?? 1,
		);
	});

	it("does not consult Deezer when iTunes already has a confident match", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({ results: [ITUNES_HIT] }),
		);
		await fetchYearCandidates(QUERY, fetchImpl as never);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain(
			"itunes.apple.com/search",
		);
	});

	it("falls back to Deezer when iTunes has nothing confident", async () => {
		const fetchImpl = vi.fn(async (input: string) => {
			const url = String(input);
			if (url.includes("itunes.apple.com")) {
				return jsonResponse({ results: [] });
			}
			if (url.includes("api.deezer.com/search/album")) {
				return jsonResponse({
					data: [
						{
							id: 42,
							title: "A Night at the Opera",
							artist: { name: "Queen" },
						},
					],
				});
			}
			return jsonResponse({ release_date: "1975-11-21" });
		});
		const candidates = await fetchYearCandidates(QUERY, fetchImpl as never);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			source: "deezer",
			year: 1975,
			releaseDate: "1975-11-21",
		});
		expect(String(fetchImpl.mock.calls[2]?.[0])).toContain(
			"api.deezer.com/album/42",
		);
	});

	it("skips Deezer's per-album detail request for weak search matches", async () => {
		const fetchImpl = vi.fn(async (input: string) => {
			const url = String(input);
			if (url.includes("itunes.apple.com")) {
				return jsonResponse({ results: [] });
			}
			return jsonResponse({
				data: [{ id: 7, title: "Completely Different", artist: { name: "Nobody" } }],
			});
		});
		const candidates = await fetchYearCandidates(QUERY, fetchImpl as never);
		expect(candidates).toEqual([]);
		// iTunes search + Deezer search only — no /album/7 detail fetch.
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("keeps iTunes results when the Deezer fallback fails", async () => {
		const fetchImpl = vi.fn(async (input: string) => {
			const url = String(input);
			if (url.includes("itunes.apple.com")) {
				return jsonResponse({
					results: [
						{
							collectionName: "Opera Nights",
							artistName: "Somebody Else",
							releaseDate: "2001-05-01T00:00:00Z",
						},
					],
				});
			}
			throw new Error("deezer down");
		});
		const candidates = await fetchYearCandidates(QUERY, fetchImpl as never);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]?.source).toBe("itunes");
	});

	it("rejects placeholder dates below the sane floor", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				results: [{ ...ITUNES_HIT, releaseDate: "0001-01-01T00:00:00Z" }],
			}),
		);
		const candidates = await fetchYearCandidates(QUERY, fetchImpl as never);
		expect(candidates).toEqual([]);
	});

	it("throws a 502 HttpError on an iTunes transport failure", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("ECONNRESET");
		});
		await expect(
			fetchYearCandidates(QUERY, fetchImpl as never),
		).rejects.toBeInstanceOf(HttpError);
	});

	it("skips the network entirely with no album or artist name", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }));
		const candidates = await fetchYearCandidates(
			{ albumName: "  ", artistName: "" },
			fetchImpl as never,
		);
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(candidates).toEqual([]);
	});
});

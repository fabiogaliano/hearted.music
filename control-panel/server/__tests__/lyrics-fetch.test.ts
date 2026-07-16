import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db");

import { read } from "../db";
import { HttpError } from "../http-error";
import {
	fetchLyricsCandidates,
	type LyricsFetchQuery,
	lyricsCandidatesForSong,
} from "../lyrics-fetch";

const QUERY: LyricsFetchQuery = {
	trackName: "Roads",
	artistName: "Portishead",
	albumName: "Dummy",
	durationSeconds: 302,
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const LRCLIB_ROADS = {
	id: 1,
	trackName: "Roads",
	artistName: "Portishead",
	albumName: "Dummy",
	duration: 303,
	instrumental: false,
	plainLyrics: "Oh, can't anybody see",
	syncedLyrics: "[00:12.30] Oh, can't anybody see",
};

describe("fetchLyricsCandidates", () => {
	it("ranks the closest name+duration match first", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse([
				{
					id: 2,
					trackName: "Roads (Live)",
					artistName: "Portishead",
					albumName: "Roseland NYC Live",
					duration: 420,
					instrumental: false,
					plainLyrics: "live version",
					syncedLyrics: null,
				},
				LRCLIB_ROADS,
			]),
		);
		const result = await fetchLyricsCandidates(QUERY, fetchImpl as never);
		expect(result.candidates[0]?.trackName).toBe("Roads");
		expect(result.candidates[0]?.durationDelta).toBe(1);
		expect(result.candidates[0]?.syncedLyrics).toContain("[00:12.30]");
	});

	it("passes the primary artist to LRCLIB and requests /api/search", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse([LRCLIB_ROADS]));
		await fetchLyricsCandidates(QUERY, fetchImpl as never);
		const calledUrl = String((fetchImpl.mock.calls[0] as unknown[])[0]);
		expect(calledUrl).toContain("/api/search");
		expect(calledUrl).toContain("track_name=Roads");
		expect(calledUrl).toContain("artist_name=Portishead");
	});

	it("treats a 404 as an empty result, not an error", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({}, 404));
		const result = await fetchLyricsCandidates(QUERY, fetchImpl as never);
		expect(result.candidates).toEqual([]);
	});

	it("throws a 502 on a transport failure", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("ECONNRESET");
		});
		await expect(
			fetchLyricsCandidates(QUERY, fetchImpl as never),
		).rejects.toBeInstanceOf(HttpError);
	});

	it("skips the network entirely with no track name", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse([]));
		const result = await fetchLyricsCandidates(
			{ ...QUERY, trackName: "  " },
			fetchImpl as never,
		);
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result.candidates).toEqual([]);
	});

	it("flags instrumental candidates", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse([{ ...LRCLIB_ROADS, instrumental: true, plainLyrics: null }]),
		);
		const result = await fetchLyricsCandidates(QUERY, fetchImpl as never);
		expect(result.candidates[0]?.instrumental).toBe(true);
	});
});

describe("lyricsCandidatesForSong", () => {
	beforeEach(() => vi.clearAllMocks());

	it("derives the query from the song and searches on the primary artist", async () => {
		vi.mocked(read).mockResolvedValue([
			{
				name: "Roads",
				artist_label: "Portishead, Beth Gibbons",
				album_name: "Dummy",
				duration_ms: 302000,
			},
		] as never);
		const fetchImpl = vi.fn(async () => jsonResponse([LRCLIB_ROADS]));
		const result = await lyricsCandidatesForSong(
			"song-1",
			{},
			fetchImpl as never,
		);
		expect(result.query.artistName).toBe("Portishead");
		expect(result.query.durationSeconds).toBe(302);
		const calledUrl = String((fetchImpl.mock.calls[0] as unknown[])[0]);
		expect(calledUrl).toContain("artist_name=Portishead");
		expect(calledUrl).not.toContain("Beth");
	});

	it("honors operator overrides over the stored metadata", async () => {
		vi.mocked(read).mockResolvedValue([
			{
				name: "Wrong Title",
				artist_label: "Wrong Artist",
				album_name: null,
				duration_ms: null,
			},
		] as never);
		const fetchImpl = vi.fn(async () => jsonResponse([]));
		const result = await lyricsCandidatesForSong(
			"song-1",
			{ track: "Roads", artist: "Portishead" },
			fetchImpl as never,
		);
		expect(result.query.trackName).toBe("Roads");
		expect(result.query.artistName).toBe("Portishead");
	});

	it("404s an unknown song", async () => {
		vi.mocked(read).mockResolvedValue([] as never);
		await expect(
			lyricsCandidatesForSong("nope", {}, (async () =>
				jsonResponse([])) as never),
		).rejects.toBeInstanceOf(HttpError);
	});
});

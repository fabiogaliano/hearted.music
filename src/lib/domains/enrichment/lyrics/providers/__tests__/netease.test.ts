import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	NeteaseFetchError,
	NeteaseParseError,
	NeteaseProvider,
	parseNeteaseLyric,
} from "../netease";

// ── Fixtures (shapes captured from the live music.163.com endpoints) ──────────

// Snooze — SZA. duration 201_851ms ≈ 202s.
const SEARCH_HIT = {
	code: 200,
	result: {
		songs: [
			{
				id: 2004563430,
				name: "Snooze",
				artists: [{ name: "SZA" }],
				album: { name: "SOS" },
				duration: 201_851,
			},
		],
	},
};

const SEARCH_EMPTY = { code: 200, result: { songCount: 0 } };

// A real-world body: a 作词 (lyricist) credit line, then two sung lines.
const LYRIC_WITH_CREDITS = {
	code: 200,
	lrc: {
		lyric:
			"[00:00.000] 作词 : SZA/Babyface\n[00:01.948]Ooh, ooh-oh, oh\n[00:05.000]And I was right there",
	},
};

// Pure-music track: a 作曲 credit followed by the instrumental sentinel.
const LYRIC_INSTRUMENTAL = {
	code: 200,
	lrc: {
		lyric: "[00:00.00] 作曲 : Ludovico Einaudi\n[00:05.00]纯音乐，请欣赏\n",
	},
};

const LYRIC_UNCOLLECTED = { code: 200, uncollected: true, lrc: { lyric: "" } };
const LYRIC_NOLYRIC = { code: 200, nolyric: true, lrc: { lyric: "" } };

const PARAMS = { trackName: "Snooze", artistName: "SZA", durationMs: 201_851 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// ── parseNeteaseLyric (pure) ───────────────────────────────────────────────────

describe("parseNeteaseLyric", () => {
	it("strips LRC timing tags and credit lines, keeping only sung lines", () => {
		const result = parseNeteaseLyric(LYRIC_WITH_CREDITS.lrc.lyric);
		expect(result).toEqual({
			kind: "lyrics",
			text: "Ooh, ooh-oh, oh\nAnd I was right there",
		});
	});

	it("classifies the pure-music sentinel as instrumental", () => {
		const result = parseNeteaseLyric(LYRIC_INSTRUMENTAL.lrc.lyric);
		expect(result).toEqual({ kind: "instrumental" });
	});

	it("treats empty / null / credits-only bodies as empty", () => {
		expect(parseNeteaseLyric("")).toEqual({ kind: "empty" });
		expect(parseNeteaseLyric(null)).toEqual({ kind: "empty" });
		expect(parseNeteaseLyric(undefined)).toEqual({ kind: "empty" });
		expect(
			parseNeteaseLyric("[00:00.00] 作词 : Someone\n[00:01.00] 作曲 : Someone"),
		).toEqual({ kind: "empty" });
	});

	it("strips English-language credit lines too", () => {
		const result = parseNeteaseLyric(
			"[00:00.00]Producer : Babyface\n[00:02.00]Real lyric line",
		);
		expect(result).toEqual({ kind: "lyrics", text: "Real lyric line" });
	});
});

// ── NeteaseProvider ─────────────────────────────────────────────────────────────

describe("NeteaseProvider", () => {
	let provider: NeteaseProvider;
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		provider = new NeteaseProvider();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns { kind: 'lyrics', source: 'netease', confidence: 0.7 } on a validated hit", async () => {
		fetchMock.mockResolvedValueOnce(json(SEARCH_HIT));
		fetchMock.mockResolvedValueOnce(json(LYRIC_WITH_CREDITS));

		const result = await provider.fetchLyrics(PARAMS);

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({
			kind: "lyrics",
			source: "netease",
			confidence: 0.7,
			text: "Ooh, ooh-oh, oh\nAnd I was right there",
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("returns instrumental from the pure-music sentinel", async () => {
		fetchMock.mockResolvedValueOnce(json(SEARCH_HIT));
		fetchMock.mockResolvedValueOnce(json(LYRIC_INSTRUMENTAL));

		const result = await provider.fetchLyrics(PARAMS);

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({ kind: "instrumental", source: "netease" });
	});

	it("returns instrumental when the response flags nolyric", async () => {
		fetchMock.mockResolvedValueOnce(json(SEARCH_HIT));
		fetchMock.mockResolvedValueOnce(json(LYRIC_NOLYRIC));

		const result = await provider.fetchLyrics(PARAMS);

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({ kind: "instrumental", source: "netease" });
	});

	it("returns not_found when the track is uncollected", async () => {
		fetchMock.mockResolvedValueOnce(json(SEARCH_HIT));
		fetchMock.mockResolvedValueOnce(json(LYRIC_UNCOLLECTED));

		const result = await provider.fetchLyrics(PARAMS);

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({ kind: "not_found" });
	});

	it("returns not_found when search has no hits (no lyric call)", async () => {
		fetchMock.mockResolvedValueOnce(json(SEARCH_EMPTY));

		const result = await provider.fetchLyrics(PARAMS);

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({ kind: "not_found" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("rejects a hit whose duration is outside ±2s", async () => {
		const farHit = {
			code: 200,
			result: {
				songs: [{ ...SEARCH_HIT.result.songs[0], duration: 100_000 }],
			},
		};
		fetchMock.mockResolvedValueOnce(json(farHit));

		const result = await provider.fetchLyrics(PARAMS);

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({ kind: "not_found" });
		// No lyric fetch — the candidate was rejected on duration.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("rejects a duration-matching hit with low name similarity", async () => {
		const wrongSong = {
			code: 200,
			result: {
				songs: [
					{
						id: 1,
						name: "Completely Unrelated Track",
						artists: [{ name: "Some Other Artist" }],
						album: { name: "X" },
						duration: 201_851,
					},
				],
			},
		};
		fetchMock.mockResolvedValueOnce(json(wrongSong));

		const result = await provider.fetchLyrics(PARAMS);

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({ kind: "not_found" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("maps a non-200 app code (-460 block) to a NeteaseFetchError carrying apiCode", async () => {
		fetchMock.mockResolvedValueOnce(json({ code: -460, msg: "Cheating" }));

		const result = await provider.fetchLyrics(PARAMS);

		expect(Result.isError(result)).toBe(true);
		if (!Result.isError(result)) return;
		expect(result.error).toBeInstanceOf(NeteaseFetchError);
		expect((result.error as NeteaseFetchError).apiCode).toBe(-460);
	});

	it("maps a non-ok HTTP status to a NeteaseFetchError with statusCode", async () => {
		fetchMock.mockResolvedValueOnce(new Response("err", { status: 503 }));

		const result = await provider.fetchLyrics(PARAMS);

		expect(Result.isError(result)).toBe(true);
		if (!Result.isError(result)) return;
		expect(result.error).toBeInstanceOf(NeteaseFetchError);
		expect((result.error as NeteaseFetchError).statusCode).toBe(503);
	});

	it("maps a schema-violating body to a NeteaseParseError", async () => {
		fetchMock.mockResolvedValueOnce(json({ unexpected: true }));

		const result = await provider.fetchLyrics(PARAMS);

		expect(Result.isError(result)).toBe(true);
		if (!Result.isError(result)) return;
		expect(result.error).toBeInstanceOf(NeteaseParseError);
	});

	it("maps a network failure to a NeteaseFetchError", async () => {
		fetchMock.mockRejectedValueOnce(new Error("Network unreachable"));

		const result = await provider.fetchLyrics(PARAMS);

		expect(Result.isError(result)).toBe(true);
		if (!Result.isError(result)) return;
		expect(result.error).toBeInstanceOf(NeteaseFetchError);
	});

	it("sends a browser-like User-Agent and a music.163.com Referer", async () => {
		fetchMock.mockResolvedValueOnce(json(SEARCH_HIT));
		fetchMock.mockResolvedValueOnce(json(LYRIC_WITH_CREDITS));

		await provider.fetchLyrics(PARAMS);

		for (const call of fetchMock.mock.calls) {
			const init = call[1] as RequestInit;
			const headers = init?.headers as Record<string, string> | undefined;
			expect(headers?.["User-Agent"]).toMatch(/Mozilla/);
			expect(headers?.Referer).toContain("music.163.com");
		}
	});

	it("queries search with '<artist> <title>' and type=1", async () => {
		fetchMock.mockResolvedValueOnce(json(SEARCH_EMPTY));

		await provider.fetchLyrics(PARAMS);

		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toContain("/api/search/get");
		// URLSearchParams encodes the space in "SZA Snooze" as '+'.
		expect(url).toContain("s=SZA+Snooze");
		expect(url).toContain("type=1");
	});
});

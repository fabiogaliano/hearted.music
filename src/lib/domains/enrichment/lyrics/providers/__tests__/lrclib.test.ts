import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LrclibFetchError, LrclibParseError, LrclibProvider } from "../lrclib";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TRACK_INSTRUMENTAL = {
	id: 1,
	trackName: "Veridis Quo",
	artistName: "Daft Punk",
	albumName: "Discovery",
	duration: 588,
	instrumental: true,
	plainLyrics: null,
	syncedLyrics: null,
};

const TRACK_WITH_LYRICS = {
	id: 2,
	trackName: "Get Lucky",
	artistName: "Daft Punk",
	albumName: "Random Access Memories",
	duration: 248,
	instrumental: false,
	plainLyrics: "Like the legend of the phoenix\nAll ends with beginnings",
	syncedLyrics: null,
};

const LRCLIB_NOT_FOUND_BODY = { code: 404, name: "TrackNotFound" };

// Params that exactly match TRACK_WITH_LYRICS (duration 248s = 248_000ms)
const LYRICS_PARAMS = {
	trackName: "Get Lucky",
	artistName: "Daft Punk",
	albumName: "Random Access Memories",
	durationMs: 248_000,
};

// Params that exactly match TRACK_INSTRUMENTAL
const INSTRUMENTAL_PARAMS = {
	trackName: "Veridis Quo",
	artistName: "Daft Punk",
	albumName: "Discovery",
	durationMs: 588_000,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function makeNotFoundResponse(): Response {
	return new Response(JSON.stringify(LRCLIB_NOT_FOUND_BODY), {
		status: 404,
		headers: { "Content-Type": "application/json" },
	});
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LrclibProvider", () => {
	let provider: LrclibProvider;
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		provider = new LrclibProvider();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe("instrumental: true — /api/get hit", () => {
		it("returns { kind: 'instrumental', source: 'lrclib' } when LRCLIB flags the track as instrumental", async () => {
			fetchMock.mockResolvedValueOnce(makeOkResponse(TRACK_INSTRUMENTAL));

			const result = await provider.fetchLyrics(INSTRUMENTAL_PARAMS);

			expect(Result.isOk(result)).toBe(true);
			if (!Result.isOk(result)) return;
			expect(result.value).toEqual({ kind: "instrumental", source: "lrclib" });

			// Confirm only /api/get was called (no search fallback needed)
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const calledUrl = fetchMock.mock.calls[0][0] as string;
			expect(calledUrl).toContain("/api/get");
		});
	});

	describe("lyrics hit — /api/get hit", () => {
		it("returns { kind: 'lyrics', source: 'lrclib', confidence: 1.0 } with the plain lyrics text", async () => {
			fetchMock.mockResolvedValueOnce(makeOkResponse(TRACK_WITH_LYRICS));

			const result = await provider.fetchLyrics(LYRICS_PARAMS);

			expect(Result.isOk(result)).toBe(true);
			if (!Result.isOk(result)) return;
			expect(result.value).toMatchObject({
				kind: "lyrics",
				source: "lrclib",
				confidence: 1.0,
				text: TRACK_WITH_LYRICS.plainLyrics,
			});
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
	});

	describe("404 TrackNotFound — /api/get miss, search also misses", () => {
		it("returns { kind: 'not_found' } when both /api/get and /api/search have no record", async () => {
			// /api/get → 404
			fetchMock.mockResolvedValueOnce(makeNotFoundResponse());
			// /api/search → empty array
			fetchMock.mockResolvedValueOnce(makeOkResponse([]));

			const result = await provider.fetchLyrics(LYRICS_PARAMS);

			expect(Result.isOk(result)).toBe(true);
			if (!Result.isOk(result)) return;
			expect(result.value).toEqual({ kind: "not_found" });
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("includes 'TrackNotFound' in the body without treating it as an error", async () => {
			fetchMock.mockResolvedValueOnce(makeNotFoundResponse());
			fetchMock.mockResolvedValueOnce(makeOkResponse([]));

			const result = await provider.fetchLyrics(INSTRUMENTAL_PARAMS);

			// A 404 is not a LrclibFetchError; it's a not_found outcome
			expect(Result.isOk(result)).toBe(true);
		});
	});

	describe("duration-mismatch search fallback", () => {
		it("accepts a search result whose duration is within ±2s of target", async () => {
			// /api/get → 404
			fetchMock.mockResolvedValueOnce(makeNotFoundResponse());

			// /api/search → one result within tolerance (duration 247 vs target 248)
			const closeCandidate = {
				...TRACK_WITH_LYRICS,
				duration: 247, // 1s off — within tolerance
			};
			fetchMock.mockResolvedValueOnce(makeOkResponse([closeCandidate]));

			const result = await provider.fetchLyrics(LYRICS_PARAMS);

			expect(Result.isOk(result)).toBe(true);
			if (!Result.isOk(result)) return;
			expect(result.value).toMatchObject({
				kind: "lyrics",
				source: "lrclib",
				confidence: 0.8, // search results get lower confidence
			});
		});

		it("rejects a search result whose duration is >2s from target", async () => {
			fetchMock.mockResolvedValueOnce(makeNotFoundResponse());

			const farCandidate = {
				...TRACK_WITH_LYRICS,
				duration: 200, // 48s off — outside tolerance
			};
			fetchMock.mockResolvedValueOnce(makeOkResponse([farCandidate]));

			const result = await provider.fetchLyrics(LYRICS_PARAMS);

			expect(Result.isOk(result)).toBe(true);
			if (!Result.isOk(result)) return;
			expect(result.value).toEqual({ kind: "not_found" });
		});

		it("rejects a search result with matching duration but low name similarity", async () => {
			fetchMock.mockResolvedValueOnce(makeNotFoundResponse());

			// Duration matches but it's a completely different song
			const wrongSong = {
				...TRACK_WITH_LYRICS,
				trackName: "Completely Different Song By Nobody",
				artistName: "Some Other Artist",
				duration: 248,
			};
			fetchMock.mockResolvedValueOnce(makeOkResponse([wrongSong]));

			const result = await provider.fetchLyrics(LYRICS_PARAMS);

			expect(Result.isOk(result)).toBe(true);
			if (!Result.isOk(result)) return;
			expect(result.value).toEqual({ kind: "not_found" });
		});

		it("returns instrumental from search fallback when the candidate is instrumental", async () => {
			fetchMock.mockResolvedValueOnce(makeNotFoundResponse());

			// Instrumental track with slightly different duration from exact match
			const instrumentalCandidate = {
				...TRACK_INSTRUMENTAL,
				duration: 587, // 1s off
			};
			fetchMock.mockResolvedValueOnce(makeOkResponse([instrumentalCandidate]));

			const result = await provider.fetchLyrics(INSTRUMENTAL_PARAMS);

			expect(Result.isOk(result)).toBe(true);
			if (!Result.isOk(result)) return;
			expect(result.value).toEqual({ kind: "instrumental", source: "lrclib" });
		});
	});

	describe("network / parse errors", () => {
		it("returns LrclibFetchError when the /api/get request fails with a non-404 status", async () => {
			fetchMock.mockResolvedValueOnce(
				new Response("Server Error", { status: 500 }),
			);

			const result = await provider.fetchLyrics(LYRICS_PARAMS);

			expect(Result.isError(result)).toBe(true);
			if (!Result.isError(result)) return;
			expect(result.error).toBeInstanceOf(LrclibFetchError);
			expect((result.error as LrclibFetchError).statusCode).toBe(500);
		});

		it("returns LrclibParseError when /api/get response does not match the schema", async () => {
			// Missing required fields
			fetchMock.mockResolvedValueOnce(makeOkResponse({ unexpected: true }));

			const result = await provider.fetchLyrics(LYRICS_PARAMS);

			expect(Result.isError(result)).toBe(true);
			if (!Result.isError(result)) return;
			expect(result.error).toBeInstanceOf(LrclibParseError);
		});

		it("returns LrclibFetchError on network failure (fetch throws)", async () => {
			fetchMock.mockRejectedValueOnce(new Error("Network unreachable"));

			const result = await provider.fetchLyrics(LYRICS_PARAMS);

			expect(Result.isError(result)).toBe(true);
			if (!Result.isError(result)) return;
			expect(result.error).toBeInstanceOf(LrclibFetchError);
		});
	});

	describe("User-Agent header", () => {
		it("sends a User-Agent header identifying the app on every request", async () => {
			fetchMock.mockResolvedValue(makeNotFoundResponse());
			fetchMock.mockResolvedValueOnce(makeNotFoundResponse());
			fetchMock.mockResolvedValueOnce(makeOkResponse([]));

			await provider.fetchLyrics(LYRICS_PARAMS);

			for (const call of fetchMock.mock.calls) {
				const init = call[1] as RequestInit;
				const headers = init?.headers as Record<string, string> | undefined;
				expect(headers?.["User-Agent"]).toMatch(/^hearted\//);
			}
		});
	});

	describe("ms→s conversion", () => {
		it("converts durationMs to seconds by rounding before sending to LRCLIB", async () => {
			fetchMock.mockResolvedValueOnce(makeOkResponse(TRACK_WITH_LYRICS));

			// 248_500ms rounds to 249s
			await provider.fetchLyrics({ ...LYRICS_PARAMS, durationMs: 248_500 });

			const calledUrl = fetchMock.mock.calls[0][0] as string;
			expect(calledUrl).toContain("duration=249");
		});
	});
});

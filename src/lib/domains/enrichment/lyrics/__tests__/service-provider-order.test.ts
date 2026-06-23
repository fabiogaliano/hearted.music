/**
 * LyricsService — flow tests for the LRCLIB-source + Genius-annotations design.
 *
 * LRCLIB is the sole lyric source; its instrumental/not_found verdicts are
 * authoritative. When LRCLIB returns lyrics, Genius is consulted via its API only
 * for annotations (best-effort) — never for lyric text. fetch is mocked and
 * routed by URL so the parallel referents calls don't depend on call ordering.
 */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LyricsService } from "../service";

// Avoid Supabase calls — cache write is non-fatal and must not affect outcomes.
vi.mock("../queries", () => ({
	upsertFetchOutcome: vi.fn().mockResolvedValue(Result.ok({})),
}));

const LRCLIB_LYRICS_TRACK = {
	id: 10,
	trackName: "Get Lucky",
	artistName: "Daft Punk",
	albumName: "Random Access Memories",
	duration: 248,
	instrumental: false,
	plainLyrics: "Like the legend of the phoenix\nAll ends with beginnings",
	syncedLyrics: null,
};

const LRCLIB_INSTRUMENTAL_TRACK = {
	id: 11,
	trackName: "Veridis Quo",
	artistName: "Daft Punk",
	albumName: "Discovery",
	duration: 588,
	instrumental: true,
	plainLyrics: null,
	syncedLyrics: null,
};

const GENIUS_SEARCH_HIT = {
	response: {
		hits: [
			{
				result: {
					id: 999,
					url: "https://genius.com/daft-punk-get-lucky-lyrics",
					title: "Get Lucky",
					primary_artist: { name: "Daft Punk" },
					primary_artists: [{ name: "Daft Punk" }],
					featured_artists: [],
				},
			},
		],
	},
};

// One referent whose fragment matches the first LRCLIB line. state "accepted"
// passes both the keep-worthiness filter and the formatter's inclusion filter.
const GENIUS_REFERENTS_PAGE1 = {
	response: {
		referents: [
			{
				fragment: "Like the legend of the phoenix",
				is_description: false,
				annotations: [
					{
						id: 5001,
						body: { plain: "A reference to the mythical bird's rebirth." },
						verified: false,
						votes_total: 42,
						state: "accepted",
						authors: [{ pinned_role: null }],
					},
				],
			},
		],
	},
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function lrclibNotFound(): Response {
	return json({ code: 404, name: "TrackNotFound" }, 404);
}

function makeService(): LyricsService {
	return new LyricsService({ accessToken: "test-token" });
}

/**
 * Routes mocked fetch by URL so referents' parallel pages resolve regardless of
 * ordering. Each handler returns a Response (or null to fall through to default).
 */
function routeFetch(handlers: {
	lrclibGet?: () => Response;
	lrclibSearch?: () => Response;
	geniusSearch?: () => Response;
	geniusReferents?: (page: number) => Response;
}) {
	return vi.fn(async (input: string | URL) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url.includes("lrclib.net/api/get")) {
			return handlers.lrclibGet?.() ?? lrclibNotFound();
		}
		if (url.includes("lrclib.net/api/search")) {
			return handlers.lrclibSearch?.() ?? json([]);
		}
		if (url.includes("api.genius.com/search")) {
			return handlers.geniusSearch?.() ?? json({ response: { hits: [] } });
		}
		if (url.includes("api.genius.com/referents")) {
			const page = Number(new URL(url).searchParams.get("page") ?? "1");
			return (
				handlers.geniusReferents?.(page) ??
				json({ response: { referents: [] } })
			);
		}
		throw new Error(`Unexpected fetch: ${url}`);
	});
}

describe("LyricsService — LRCLIB source + Genius annotations", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns LRCLIB lyrics enriched with a matched Genius annotation", async () => {
		fetchMock.mockImplementation(
			routeFetch({
				lrclibGet: () => json(LRCLIB_LYRICS_TRACK),
				geniusSearch: () => json(GENIUS_SEARCH_HIT),
				geniusReferents: (page) =>
					page === 1
						? json(GENIUS_REFERENTS_PAGE1)
						: json({ response: { referents: [] } }),
			}),
		);

		const service = makeService();
		const result = await service.fetchAndStoreOutcome({
			songId: "s1",
			artist: "Daft Punk",
			song: "Get Lucky",
			albumName: "Random Access Memories",
			durationMs: 248_000,
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toMatchObject({
			kind: "lyrics",
			source: "lrclib",
			confidence: 1.0,
		});
		if (result.value.kind !== "lyrics") return;
		// The matched annotation is formatted into the stored text.
		expect(result.value.text).toContain("Like the legend of the phoenix");
		expect(result.value.text).toContain("mythical bird's rebirth");
	});

	it("stores plain LRCLIB lyrics when Genius annotation lookup misses (best-effort)", async () => {
		fetchMock.mockImplementation(
			routeFetch({
				lrclibGet: () => json(LRCLIB_LYRICS_TRACK),
				geniusSearch: () => json({ response: { hits: [] } }), // no Genius match
			}),
		);

		const service = makeService();
		const result = await service.fetchAndStoreOutcome({
			songId: "s2",
			artist: "Daft Punk",
			song: "Get Lucky",
			albumName: "Random Access Memories",
			durationMs: 248_000,
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result) || result.value.kind !== "lyrics") return;
		expect(result.value.source).toBe("lrclib");
		expect(result.value.text).toContain("Like the legend of the phoenix");
		// No annotation marker since none were placed.
		expect(result.value.text).not.toContain("  > ");
	});

	it("returns LRCLIB instrumental authoritatively, never calling Genius", async () => {
		fetchMock.mockImplementation(
			routeFetch({ lrclibGet: () => json(LRCLIB_INSTRUMENTAL_TRACK) }),
		);

		const service = makeService();
		const result = await service.fetchAndStoreOutcome({
			songId: "s3",
			artist: "Daft Punk",
			song: "Veridis Quo",
			albumName: "Discovery",
			durationMs: 588_000,
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({ kind: "instrumental", source: "lrclib" });
		// Exactly one call: LRCLIB. Genius is never consulted for an instrumental.
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url] = fetchMock.mock.calls[0] as [string];
		expect(url).toContain("lrclib.net");
	});

	it("returns not_found when LRCLIB has no record (no Genius lyric fallback)", async () => {
		fetchMock.mockImplementation(
			routeFetch({
				lrclibGet: () => lrclibNotFound(),
				lrclibSearch: () => json([]),
			}),
		);

		const service = makeService();
		const result = await service.fetchAndStoreOutcome({
			songId: "s4",
			artist: "Unknown",
			song: "Obscure Track",
			albumName: "Some Album",
			durationMs: 200_000,
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({ kind: "not_found" });
		// Genius is never asked for lyric text.
		const calledGenius = fetchMock.mock.calls.some(([u]) =>
			String(u).includes("api.genius.com"),
		);
		expect(calledGenius).toBe(false);
	});

	it("returns not_found without any fetch when album/duration are absent", async () => {
		fetchMock.mockImplementation(routeFetch({}));

		const service = makeService();
		const result = await service.fetchAndStoreOutcome({
			songId: "s5",
			artist: "Daft Punk",
			song: "Get Lucky",
			// albumName and durationMs deliberately omitted
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({ kind: "not_found" });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("surfaces a transient LRCLIB error as a retry-eligible failure (no row written)", async () => {
		fetchMock.mockImplementation(
			routeFetch({ lrclibGet: () => new Response("err", { status: 500 }) }),
		);

		const service = makeService();
		const result = await service.fetchAndStoreOutcome({
			songId: "s6",
			artist: "Daft Punk",
			song: "Get Lucky",
			albumName: "Random Access Memories",
			durationMs: 248_000,
		});

		expect(Result.isError(result)).toBe(true);
	});

	it("retries a transient 5xx from Genius search and still places the annotation", async () => {
		// Annotation enrichment is best-effort and swallows failures, so a retry
		// regression would degrade silently (annotations quietly stop appearing).
		// This guards the live withRetry/isGeniusRetryable path on the search call.
		let geniusSearchCalls = 0;
		fetchMock.mockImplementation(
			routeFetch({
				lrclibGet: () => json(LRCLIB_LYRICS_TRACK),
				geniusSearch: () => {
					geniusSearchCalls += 1;
					return geniusSearchCalls === 1
						? new Response("upstream", { status: 503 })
						: json(GENIUS_SEARCH_HIT);
				},
				geniusReferents: (page) =>
					page === 1
						? json(GENIUS_REFERENTS_PAGE1)
						: json({ response: { referents: [] } }),
			}),
		);

		const service = makeService();
		const result = await service.fetchAndStoreOutcome({
			songId: "s7",
			artist: "Daft Punk",
			song: "Get Lucky",
			albumName: "Random Access Memories",
			durationMs: 248_000,
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result) || result.value.kind !== "lyrics") return;
		// The 503 was retried (≥2 search calls) and the annotation still landed.
		expect(geniusSearchCalls).toBeGreaterThanOrEqual(2);
		expect(result.value.text).toContain("mythical bird's rebirth");
	});
});

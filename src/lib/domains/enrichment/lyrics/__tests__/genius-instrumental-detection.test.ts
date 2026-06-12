/**
 * Snapshot tests for Genius instrumental-page detection (Decision 2).
 *
 * Fixture approach: CONSTRUCTED minimal HTML, not fetched from Genius.
 * Rationale: avoids network dependency, deterministic, and covers exactly
 * the properties the code branches on. The instrumental marker string is
 * pinned in GENIUS_INSTRUMENTAL_MARKER (service.ts) and tested here so
 * a Genius copy change fails loudly rather than silently routing through
 * the parse-error path.
 *
 * Two fixture files (located in __tests__/fixtures/):
 *   - instrumental-page.html: has lyrics-root, no lyrics container,
 *     contains "This song is an instrumental"
 *   - lyrical-page.html: has lyrics-root, has lyrics container with text,
 *     does NOT contain the instrumental marker
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeniusParseError } from "@/lib/shared/errors/external/genius";
import { GENIUS_INSTRUMENTAL_MARKER, LyricsService } from "../service";

// Avoid Supabase calls during unit tests — cache read/write is a non-fatal
// optimization and must not affect the outcome under test.
vi.mock("../queries", () => ({
	getSongLyricsDocument: vi.fn().mockResolvedValue(Result.ok(null)),
	upsertSongLyrics: vi.fn().mockResolvedValue(Result.ok({})),
	upsertFetchOutcome: vi.fn().mockResolvedValue(Result.ok({})),
	LYRICS_SCHEMA_VERSION: 1,
}));

const FIXTURES_DIR = resolve(__dirname, "fixtures");

function loadFixture(filename: string): string {
	return readFileSync(resolve(FIXTURES_DIR, filename), "utf-8");
}

const INSTRUMENTAL_HTML = loadFixture("instrumental-page.html");
const LYRICAL_HTML = loadFixture("lyrical-page.html");

// ── Pin the exact marker string ───────────────────────────────────────────────

describe("GENIUS_INSTRUMENTAL_MARKER", () => {
	it("is the exact string Genius renders on instrumental pages", () => {
		// This test fails if the marker string changes in service.ts — the fixture
		// must be updated at the same time so marker detection stays correct.
		expect(GENIUS_INSTRUMENTAL_MARKER).toBe("This song is an instrumental");
		expect(INSTRUMENTAL_HTML).toContain(GENIUS_INSTRUMENTAL_MARKER);
	});

	it("is absent from the lyrical-page fixture", () => {
		expect(LYRICAL_HTML).not.toContain(GENIUS_INSTRUMENTAL_MARKER);
	});
});

// ── fetchHtml integration via LyricsService ───────────────────────────────────

describe("LyricsService — Genius instrumental-page detection (Decision 2)", () => {
	let service: LyricsService;
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		service = new LyricsService({ accessToken: "test-token" });
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function makeHtmlResponse(html: string): Response {
		return new Response(html, {
			status: 200,
			headers: { "Content-Type": "text/html" },
		});
	}

	it("instrumental fixture: marker present → fetchAndStoreOutcome returns instrumental outcome", async () => {
		// Genius search returns a hit
		const searchResponse = {
			response: {
				hits: [
					{
						result: {
							id: 1,
							url: "https://genius.com/Brock-berrigan-crossing-paths-lyrics",
							title: "Crossing Paths",
							primary_artist: { name: "Brock Berrigan" },
							primary_artists: [{ name: "Brock Berrigan" }],
							featured_artists: [],
						},
					},
				],
			},
		};

		// First fetch = Genius search API
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify(searchResponse), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		// Subsequent fetches = HTML page + referents pages (referents use fetch too)
		fetchMock.mockResolvedValue(makeHtmlResponse(INSTRUMENTAL_HTML));

		const result = await service.fetchAndStoreOutcome({
			songId: "song-crossing-paths",
			artist: "Brock Berrigan",
			song: "Crossing Paths",
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toEqual({
			kind: "instrumental",
			source: "genius_page",
		});
	});

	it("lyrical fixture: marker absent, container present → fetchAndStoreOutcome returns lyrics", async () => {
		const searchResponse = {
			response: {
				hits: [
					{
						result: {
							id: 2,
							url: "https://genius.com/Arctic-monkeys-mardy-bum-lyrics",
							title: "Mardy Bum",
							primary_artist: { name: "Arctic Monkeys" },
							primary_artists: [{ name: "Arctic Monkeys" }],
							featured_artists: [],
						},
					},
				],
			},
		};

		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify(searchResponse), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		// HTML page is used for the lyrics fetch; referents use JSON endpoint
		fetchMock.mockResolvedValue(makeHtmlResponse(LYRICAL_HTML));

		const result = await service.fetchAndStoreOutcome({
			songId: "song-mardy-bum",
			artist: "Arctic Monkeys",
			song: "Mardy Bum",
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;
		expect(result.value).toMatchObject({ kind: "lyrics", source: "genius" });
	});

	it("page with no lyrics container AND no marker → GeniusParseError (not instrumental, not not_found)", async () => {
		// A page that has lyrics-root but neither a lyrics container nor the marker
		// — this is a layout change, treat as unconfirmed provider error.
		const brokenHtml = `
      <html><body>
        <div id="lyrics-root">
          <div>Some other content but no lyrics container and no instrumental marker</div>
        </div>
      </body></html>
    `;

		const searchResponse = {
			response: {
				hits: [
					{
						result: {
							id: 3,
							url: "https://genius.com/Unknown-song-lyrics",
							title: "Unknown Song",
							primary_artist: { name: "Artist" },
							primary_artists: [{ name: "Artist" }],
							featured_artists: [],
						},
					},
				],
			},
		};

		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify(searchResponse), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		fetchMock.mockResolvedValue(makeHtmlResponse(brokenHtml));

		const result = await service.fetchAndStoreOutcome({
			songId: "song-unknown",
			artist: "Artist",
			song: "Unknown Song",
		});

		// Must be an error (GeniusParseError), not instrumental, not not_found
		expect(Result.isError(result)).toBe(true);
		if (!Result.isError(result)) return;
		expect(result.error).toBeInstanceOf(GeniusParseError);
	});
});

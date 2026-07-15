import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db");

import type { TxRun } from "../db";
import { read, tx } from "../db";
import { HttpError } from "../http-error";
import {
	buildLyricsSections,
	countLyricsBuckets,
	lyricsReviewsPage,
	mapRow,
	markInstrumental,
	saveManualLyrics,
	validateLyricsText,
} from "../lyrics-reviews";

describe("mapRow → UI shape", () => {
	it("maps snake_case DB columns to the camelCase UI shape", () => {
		const row = mapRow({
			song_id: "song-1",
			song_name: "Wonderwall - Remastered",
			artist_label: "Oasis",
			album_name: "(What's the Story) Morning Glory?",
			image_url: "https://img/cover.jpg",
			duration_ms: 258000,
			fetch_status: "not_found",
			fetch_source: null,
			fetch_updated_at: "2026-06-15T10:00:00Z",
		});
		expect(row.songId).toBe("song-1");
		expect(row.songName).toBe("Wonderwall - Remastered");
		expect(row.artistLabel).toBe("Oasis");
		expect(row.albumName).toBe("(What's the Story) Morning Glory?");
		expect(row.durationMs).toBe(258000);
		expect(row.fetchStatus).toBe("not_found");
		expect(row.fetchSource).toBeNull();
		expect(row.fetchUpdatedAt).toBe("2026-06-15T10:00:00Z");
	});

	it("coerces nulls without throwing", () => {
		const row = mapRow({
			song_id: "song-2",
			song_name: "Bare",
			artist_label: null,
			album_name: null,
			image_url: null,
			duration_ms: null,
			fetch_status: "instrumental",
			fetch_source: "lrclib",
			fetch_updated_at: "2026-06-15T10:00:00Z",
		});
		expect(row.artistLabel).toBe("");
		expect(row.albumName).toBeNull();
		expect(row.imageUrl).toBeNull();
		expect(row.durationMs).toBeNull();
		expect(row.fetchStatus).toBe("instrumental");
		expect(row.fetchSource).toBe("lrclib");
	});
});

describe("lyricsReviewsPage → filter semantics", () => {
	function captureSql(): { queries: string[]; params: unknown[][] } {
		const queries: string[] = [];
		const params: unknown[][] = [];
		vi.mocked(read).mockImplementation((async (text: string, p: unknown[] = []) => {
			queries.push(text);
			params.push(p);
			if (/count\(\*\) as total/.test(text)) return [{ total: "0" }];
			return [];
		}) as typeof read);
		return { queries, params };
	}

	function url(search: string): URL {
		return new URL(`https://panel.test/api/lyrics-reviews${search}`);
	}

	beforeEach(() => vi.clearAllMocks());

	it("needs_review filters on latest not_found, scoped to entitled likers", async () => {
		const { queries } = captureSql();
		await lyricsReviewsPage(url("?filter=needs_review"));
		// queries[1] is the row page (queries[0] is the count).
		expect(queries[1]).toMatch(/latest\.fetch_status = 'not_found'/);
		expect(queries[1]).toMatch(/from public\.liked_song ls/);
		expect(queries[1]).toMatch(/account_song_unlock/);
		expect(queries[1]).toMatch(/unlimited_access_source/);
		expect(queries[1]).toMatch(/join lateral/);
	});

	it("instrumental filters on latest instrumental", async () => {
		const { queries } = captureSql();
		await lyricsReviewsPage(url("?filter=instrumental"));
		expect(queries[1]).toMatch(/latest\.fetch_status = 'instrumental'/);
		expect(queries[1]).toMatch(/from public\.liked_song ls/);
	});

	it("defaults to the needs_review (manual-entry) queue", async () => {
		const { queries } = captureSql();
		await lyricsReviewsPage(url(""));
		expect(queries[1]).toMatch(/latest\.fetch_status = 'not_found'/);
	});

	it("binds an escaped search pattern against name and artists", async () => {
		const { queries, params } = captureSql();
		await lyricsReviewsPage(url("?q=won_der"));
		expect(queries[1]).toMatch(/s\.name ilike \$1 or array_to_string\(s\.artists/);
		expect(params[1]?.[0]).toBe("%won\\_der%");
	});

	it("filters on an explicit provider source when supplied", async () => {
		const { queries, params } = captureSql();
		await lyricsReviewsPage(url("?source=lrclib"));
		expect(queries[1]).toMatch(/latest\.fetch_source = \$1/);
		expect(params[1]?.[0]).toBe("lrclib");
	});

	it("flips ordering direction with the order toggle", async () => {
		const { queries } = captureSql();
		await lyricsReviewsPage(url("?filter=needs_review&order=newest"));
		expect(queries[1]).toMatch(/order by latest\.updated_at desc/);
		await lyricsReviewsPage(url("?filter=needs_review"));
		expect(queries[3]).toMatch(/order by latest\.updated_at asc/);
	});
});

describe("countLyricsBuckets", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns both cohorts as numbers", async () => {
		vi.mocked(read).mockResolvedValue([
			{ needs_review: "304", instrumental: "102" },
		]);
		const counts = await countLyricsBuckets();
		expect(counts).toEqual({ needsReview: 304, instrumental: 102 });
		expect(vi.mocked(read).mock.calls[0]?.[0]).toMatch(
			/from public\.liked_song ls/,
		);
	});
});

describe("buildLyricsSections", () => {
	it("wraps plain text as a single numbered-line section", () => {
		const sections = buildLyricsSections("line one\nline two");
		expect(sections).toEqual([
			{
				type: "lyrics",
				lines: [
					{ id: 1, text: "line one" },
					{ id: 2, text: "line two" },
				],
			},
		]);
	});

	it("normalizes CRLF and trims surrounding blank lines, keeping interior ones", () => {
		const sections = buildLyricsSections("\r\nverse one\r\n\r\nverse two\r\n");
		expect(sections[0]?.lines).toEqual([
			{ id: 1, text: "verse one" },
			{ id: 2, text: "" },
			{ id: 3, text: "verse two" },
		]);
	});
});

describe("validateLyricsText", () => {
	it("accepts non-empty text", () => {
		expect(validateLyricsText("some lyrics")).toBe("some lyrics");
	});

	it("rejects empty / whitespace / non-string as a 400 HttpError", () => {
		for (const bad of ["", "   ", null, undefined, 42]) {
			let caught: unknown;
			try {
				validateLyricsText(bad);
			} catch (err) {
				caught = err;
			}
			expect(caught).toBeInstanceOf(HttpError);
			expect((caught as HttpError).status).toBe(400);
		}
	});
});

function stubTx(insertReturns: Array<{ id: string }>) {
	const queries: string[] = [];
	const params: unknown[][] = [];
	vi.mocked(tx).mockImplementation((async (
		fn: (run: TxRun) => Promise<unknown>,
	) => {
		const run: TxRun = (async (text: string, p: unknown[] = []) => {
			queries.push(text);
			params.push(p);
			if (/insert into public\.song_lyrics/.test(text)) return insertReturns;
			return [];
		}) as TxRun;
		return fn(run);
	}) as typeof tx);
	return { queries, params };
}

describe("saveManualLyrics", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: the song exists, so the FK-guard existence check passes.
		vi.mocked(read).mockResolvedValue([{ id: "song-1" }]);
	});

	it("validates before touching the database", async () => {
		stubTx([{ id: "ly-1" }]);
		await expect(saveManualLyrics("song-1", "   ")).rejects.toThrow();
		expect(tx).not.toHaveBeenCalled();
		// Validation precedes even the song existence check.
		expect(read).not.toHaveBeenCalled();
	});

	it("upserts a manual lyrics row keyed on (song_id, source)", async () => {
		const { queries, params } = stubTx([{ id: "ly-1" }]);

		const result = await saveManualLyrics("song-1", "hello\nworld");

		expect(result).toEqual({ ok: true, songId: "song-1" });
		const insert = queries.find((q) =>
			/insert into public\.song_lyrics/.test(q),
		);
		expect(insert).toMatch(/on conflict \(song_id, source\) do update/);
		expect(insert).toMatch(/fetch_status, fetch_source/);
		// fetch_status is 'lyrics' and fetch_source is null (the CHECK forbids
		// 'manual'); provenance lives in the source column instead.
		expect(insert).toMatch(/'lyrics', null/);
		const [songId, source, documentJson, contentHash, schemaVersion] =
			params[0] ?? [];
		expect(songId).toBe("song-1");
		expect(source).toBe("manual");
		expect(schemaVersion).toBe(1);
		expect(String(contentHash)).toMatch(/^ly_v1_[0-9a-f]{16}$/);
		const doc = JSON.parse(String(documentJson));
		expect(doc.schemaVersion).toBe(1);
		expect(doc.source).toBe("manual");
		expect(doc.sections[0].lines).toEqual([
			{ id: 1, text: "hello" },
			{ id: 2, text: "world" },
		]);
	});

	it("throws a 404 HttpError when the song does not exist", async () => {
		// FK guard: a missing song must be a clean 404, not an FK-violation 500.
		vi.mocked(read).mockResolvedValue([]);
		stubTx([{ id: "ly-1" }]);
		const caught = await saveManualLyrics("missing", "x").catch(
			(err: unknown) => err,
		);
		expect(caught).toBeInstanceOf(HttpError);
		expect((caught as HttpError).status).toBe(404);
		// The existence check ran against the song table...
		expect(vi.mocked(read).mock.calls[0]?.[0]).toMatch(
			/from public\.song where id = \$1/,
		);
		// ...and the FK-violating upsert was never attempted.
		expect(tx).not.toHaveBeenCalled();
	});
});

describe("markInstrumental", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(read).mockResolvedValue([{ id: "song-1" }]);
	});

	it("upserts a sentinel instrumental row under source='manual'", async () => {
		const { queries, params } = stubTx([{ id: "ly-2" }]);

		const result = await markInstrumental("song-1");

		expect(result).toEqual({ ok: true, songId: "song-1" });
		const insert = queries.find((q) =>
			/insert into public\.song_lyrics/.test(q),
		);
		expect(insert).toMatch(/on conflict \(song_id, source\) do update/);
		// No document; instrumental status; null fetch_source.
		expect(insert).toMatch(/'instrumental'/);
		const [songId, source, contentHash, schemaVersion] = params[0] ?? [];
		expect(songId).toBe("song-1");
		expect(source).toBe("manual");
		expect(contentHash).toBe("no-content");
		expect(schemaVersion).toBe(0);
	});

	it("throws a 404 HttpError when the song does not exist", async () => {
		vi.mocked(read).mockResolvedValue([]);
		stubTx([{ id: "ly-2" }]);
		const caught = await markInstrumental("missing").catch(
			(err: unknown) => err,
		);
		expect(caught).toBeInstanceOf(HttpError);
		expect((caught as HttpError).status).toBe(404);
		expect(tx).not.toHaveBeenCalled();
	});
});

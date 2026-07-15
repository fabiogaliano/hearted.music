import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db");

import { read, type TxRun, tx } from "../db";
import {
	approveInstrumentalReview,
	instrumentalReviewsPage,
	mapRow,
	rejectInstrumentalReview,
} from "../instrumental-reviews";

describe("mapRow → UI shape", () => {
	it("maps snake_case DB columns to the camelCase UI shape", () => {
		const row = mapRow({
			id: "rev-1",
			status: "pending",
			signal: "genre",
			instrumentalness: 0.42,
			matched_genre: "ambient",
			created_at: "2026-06-20T10:00:00Z",
			song_id: "song-1",
			song_name: "Intro - Live",
			artist_label: "Some Artist",
			album_name: "An Album",
			image_url: "https://img/cover.jpg",
			duration_ms: 192000,
		});
		expect(row.id).toBe("rev-1");
		expect(row.status).toBe("pending");
		expect(row.signal).toBe("genre");
		expect(row.instrumentalness).toBeCloseTo(0.42);
		expect(row.matchedGenre).toBe("ambient");
		expect(row.songId).toBe("song-1");
		expect(row.songName).toBe("Intro - Live");
		expect(row.artistLabel).toBe("Some Artist");
		expect(row.albumName).toBe("An Album");
		expect(row.durationMs).toBe(192000);
	});

	it("coerces nulls without throwing", () => {
		const row = mapRow({
			id: "rev-2",
			status: "pending",
			signal: "instrumentalness",
			instrumentalness: null,
			matched_genre: null,
			created_at: "2026-06-20T10:00:00Z",
			song_id: "song-2",
			song_name: "Bare",
			artist_label: null,
			album_name: null,
			image_url: null,
			duration_ms: null,
		});
		expect(row.instrumentalness).toBeNull();
		expect(row.matchedGenre).toBeNull();
		expect(row.artistLabel).toBe("");
		expect(row.albumName).toBeNull();
		expect(row.durationMs).toBeNull();
	});
});

describe("instrumentalReviewsPage", () => {
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
		return new URL(`https://panel.test/api/instrumental-reviews${search}`);
	}

	beforeEach(() => vi.clearAllMocks());

	it("filters by status and joins the song", async () => {
		const { queries, params } = captureSql();
		await instrumentalReviewsPage(url("?status=pending"));
		// queries[1] is the row page (queries[0] is the count).
		expect(queries[1]).toMatch(/from public\.song_instrumental_review r/);
		expect(queries[1]).toMatch(/join public\.song s on s\.id = r\.song_id/);
		expect(queries[1]).toMatch(/where r\.status = \$1/);
		// Pending queue hides superseded cards: only songs still settled by the
		// 'analysis' verdict are actionable.
		expect(queries[1]).toMatch(/latest\.source = 'analysis'/);
		expect(params[1]?.[0]).toBe("pending");
	});

	it("omits the liveness filter for non-pending audit lookups", async () => {
		const { queries } = captureSql();
		await instrumentalReviewsPage(url("?status=rejected"));
		expect(queries[1]).toMatch(/where r\.status = \$1/);
		expect(queries[1]).not.toMatch(/latest\.source = 'analysis'/);
	});

	it("binds search, signal, and instrumentalness-threshold filters", async () => {
		const { queries, params } = captureSql();
		await instrumentalReviewsPage(
			url("?status=pending&q=intro&signal=genre&minInstrumentalness=0.8"),
		);
		expect(queries[1]).toMatch(/s\.name ilike/);
		expect(queries[1]).toMatch(/r\.signal = \$/);
		expect(queries[1]).toMatch(/r\.instrumentalness >= \$/);
		expect(params[1]).toContain("%intro%");
		expect(params[1]).toContain("genre");
		expect(params[1]).toContain(0.8);
	});

	it("flips ordering direction with the order toggle", async () => {
		const { queries } = captureSql();
		await instrumentalReviewsPage(url("?order=oldest"));
		expect(queries[1]).toMatch(/order by r\.created_at asc/);
		await instrumentalReviewsPage(url(""));
		expect(queries[3]).toMatch(/order by r\.created_at desc/);
	});
});

function stubTx(
	reviewRow: Record<string, unknown> | null,
	latestRow: Record<string, unknown> | null = null,
) {
	const queries: string[] = [];
	vi.mocked(tx).mockImplementation((async (
		fn: (run: TxRun) => Promise<unknown>,
	) => {
		const run: TxRun = (async (text: string) => {
			queries.push(text);
			if (/from public\.song_instrumental_review/.test(text) && /for update/.test(text)) {
				return reviewRow ? [reviewRow] : [];
			}
			// The liveness lookup: latest song_lyrics row for the song.
			if (/select source, fetch_status from public\.song_lyrics/.test(text)) {
				return latestRow ? [latestRow] : [];
			}
			if (/delete from public\.song_lyrics/.test(text)) return [{ id: "ly-1" }];
			if (/delete from public\.song_embedding/.test(text)) return [{ id: "emb-1" }];
			if (/delete from public\.song_analysis/.test(text)) return [{ id: "an-1" }];
			return [];
		}) as TxRun;
		return fn(run);
	}) as typeof tx);
	return { queries };
}

describe("approveInstrumentalReview", () => {
	beforeEach(() => vi.clearAllMocks());

	it("marks the review approved when pending", async () => {
		const queries: string[] = [];
		vi.mocked(tx).mockImplementation((async (
			fn: (run: TxRun) => Promise<unknown>,
		) => {
			const run: TxRun = (async (text: string) => {
				queries.push(text);
				return [{ id: "rev-1" }];
			}) as TxRun;
			return fn(run);
		}) as typeof tx);

		const result = await approveInstrumentalReview("rev-1", "operator");
		expect(result).toEqual({ ok: true, id: "rev-1" });
		expect(queries[0]).toMatch(/update public\.song_instrumental_review/);
		expect(queries[0]).toMatch(/status = 'approved'/);
		expect(queries[0]).toMatch(/and status = 'pending'/);
	});

	it("throws when the review is gone or no longer pending", async () => {
		vi.mocked(tx).mockImplementation((async (
			fn: (run: TxRun) => Promise<unknown>,
		) => {
			const run: TxRun = (async () => []) as TxRun;
			return fn(run);
		}) as typeof tx);

		await expect(approveInstrumentalReview("rev-1", "operator")).rejects.toThrow(
			/not found or no longer pending/i,
		);
	});
});

describe("rejectInstrumentalReview", () => {
	beforeEach(() => vi.clearAllMocks());

	it("undoes the verdict: deletes settle row + analysis + embedding, then marks rejected", async () => {
		// Song is still settled instrumental by the auto-verdict → safe to undo.
		const { queries } = stubTx(
			{ song_id: "song-1" },
			{ source: "analysis", fetch_status: "instrumental" },
		);

		const result = await rejectInstrumentalReview("rev-1", "operator", "has vocals");

		expect(result.ok).toBe(true);
		expect(result.songId).toBe("song-1");
		expect(result.superseded).toBe(false);
		expect(result.deletedSettleRows).toBe(1);
		expect(result.deletedAnalyses).toBe(1);
		expect(result.deletedEmbeddings).toBe(1);

		// The 'analysis' settle row is removed so the song leaves the instrumental state.
		const settleDelete = queries.find((q) =>
			/delete from public\.song_lyrics/.test(q),
		);
		expect(settleDelete).toMatch(/source = 'analysis'/);
		// Downstream artifacts produced by the wrong verdict are removed.
		expect(queries.some((q) => /delete from public\.song_analysis/.test(q))).toBe(true);
		expect(queries.some((q) => /delete from public\.song_embedding/.test(q))).toBe(true);
		// The review is marked rejected — the standing veto for the analyzer.
		const update = queries.find((q) =>
			/update public\.song_instrumental_review/.test(q),
		);
		expect(update).toMatch(/status = 'rejected'/);
	});

	it("does NOT delete the analysis when the song was already overridden (data-loss guard)", async () => {
		// A manual-lyrics entry already turned the song lyrical: latest row is a
		// 'manual' lyrics row, not the 'analysis' settle. Rejecting the stale card
		// must NOT delete the new, correct lyrical analysis/embedding.
		const { queries } = stubTx(
			{ song_id: "song-1" },
			{ source: "manual", fetch_status: "lyrics" },
		);

		const result = await rejectInstrumentalReview("rev-1", "operator", "has vocals");

		expect(result.ok).toBe(true);
		expect(result.superseded).toBe(true);
		expect(result.deletedSettleRows).toBe(0);
		expect(result.deletedAnalyses).toBe(0);
		expect(result.deletedEmbeddings).toBe(0);

		// Nothing was deleted — the corrected artifacts survive.
		expect(queries.some((q) => /delete from public\.song_analysis/.test(q))).toBe(false);
		expect(queries.some((q) => /delete from public\.song_embedding/.test(q))).toBe(false);
		expect(queries.some((q) => /delete from public\.song_lyrics/.test(q))).toBe(false);
		// The rejection is still recorded.
		const update = queries.find((q) =>
			/update public\.song_instrumental_review/.test(q),
		);
		expect(update).toMatch(/status = 'rejected'/);
	});

	it("throws when the review is gone or no longer pending", async () => {
		stubTx(null);
		await expect(
			rejectInstrumentalReview("rev-1", "operator", null),
		).rejects.toThrow(/not found or no longer pending/i);
	});
});

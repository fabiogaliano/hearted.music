import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db");
vi.mock("@/lib/domains/enrichment/audio-feature-backfill/wake");

import { wakeEnrichmentForSong } from "@/lib/domains/enrichment/audio-feature-backfill/wake";
import { mapJobRow, submitManualUrl } from "../audio-feature-jobs";
import type { TxRun } from "../db";
import { read, tx } from "../db";

describe("mapJobRow → UI shape", () => {
	it("maps snake_case columns to the camelCase UI shape", () => {
		const row = mapJobRow({
			job_id: "job-1",
			song_id: "song-1",
			status: "manual_needed",
			error_code: "yt_search_low_confidence",
			error_message: "best candidate scored 0.41",
			attempts: 3,
			source_url: null,
			created_at: "2026-06-20T10:00:00Z",
			updated_at: "2026-06-21T10:00:00Z",
			song_name: "Some Song",
			artist_label: "Some Artist, Featured",
			album_name: "An Album",
			image_url: "https://img/cover.jpg",
			duration_ms: 215000,
			candidates: [
				{
					videoId: "cand",
					url: "https://www.youtube.com/watch?v=cand",
					title: "Some Artist - Some Song (En Vivo)",
					channel: "Fan Uploads",
					durationSeconds: 246,
					thumbnailUrl: null,
					score: 0.63,
					reasons: ["title partially matches song title"],
					rejected: false,
					rejectReason: null,
					rank: 1,
				},
			],
		});
		expect(row.jobId).toBe("job-1");
		expect(row.songId).toBe("song-1");
		expect(row.status).toBe("manual_needed");
		expect(row.errorCode).toBe("yt_search_low_confidence");
		expect(row.errorMessage).toBe("best candidate scored 0.41");
		expect(row.attempts).toBe(3);
		expect(row.songName).toBe("Some Song");
		// artist_label is array_to_string'd server-side, so it's a plain string —
		// never the raw text[] literal the type-less pooler would hand back.
		expect(row.artistLabel).toBe("Some Artist, Featured");
		expect(row.albumName).toBe("An Album");
		expect(row.spotifyDurationMs).toBe(215000);
		// The scored candidate set behind the low-confidence verdict is surfaced so
		// the operator can see the exact link that fell short and why.
		expect(row.candidates).toHaveLength(1);
		expect(row.candidates[0]).toMatchObject({
			videoId: "cand",
			score: 0.63,
			rank: 1,
			rejected: false,
			reasons: ["title partially matches song title"],
		});
	});

	it("coerces nulls and missing optional columns without throwing", () => {
		const row = mapJobRow({
			job_id: "job-2",
			song_id: "song-2",
			status: "failed",
			created_at: "2026-06-20T10:00:00Z",
			updated_at: "2026-06-20T10:00:00Z",
			song_name: "Bare",
		});
		expect(row.errorCode).toBeNull();
		expect(row.errorMessage).toBeNull();
		expect(row.attempts).toBe(0);
		expect(row.sourceUrl).toBeNull();
		expect(row.artistLabel).toBe("");
		expect(row.albumName).toBeNull();
		expect(row.imageUrl).toBeNull();
		expect(row.spotifyDurationMs).toBeNull();
		// A job with no captured candidates (predates the column, or never searched)
		// maps to an empty list, not a throw.
		expect(row.candidates).toEqual([]);
	});
});

describe("submitManualUrl", () => {
	let queries: string[];
	let params: unknown[][];

	function stub() {
		queries = [];
		params = [];
		// ensureSongExists reads the song row; return one so the guard passes.
		vi.mocked(read).mockResolvedValue([{ id: "song-1" }] as never);
		vi.mocked(tx).mockImplementation((async (
			fn: (run: TxRun) => Promise<unknown>,
		) => {
			const run: TxRun = (async (text: string, p: unknown[] = []) => {
				queries.push(text);
				params.push(p);
				if (/enqueue_audio_feature_backfill_manual/.test(text)) {
					return [{ id: "new-job-1" }];
				}
				return [];
			}) as TxRun;
			return fn(run);
		}) as typeof tx);
		vi.mocked(wakeEnrichmentForSong).mockResolvedValue(["acc-1"]);
	}

	beforeEach(() => {
		vi.clearAllMocks();
		stub();
	});

	it("enqueues a manual backfill with the canonical URL and wakes enrichment", async () => {
		const result = await submitManualUrl(
			"song-1",
			"https://youtu.be/dQw4w9WgXcQ?t=10",
		);

		expect(result.ok).toBe(true);
		expect(result.songId).toBe("song-1");
		expect(result.jobId).toBe("new-job-1");
		// The raw URL is normalized to the canonical watch form before enqueue.
		expect(result.canonicalUrl).toBe(
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		);

		const enqueue = queries.findIndex((q) =>
			/enqueue_audio_feature_backfill_manual/.test(q),
		);
		expect(enqueue).toBeGreaterThanOrEqual(0);
		expect(params[enqueue]).toEqual([
			"song-1",
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		]);

		expect(wakeEnrichmentForSong).toHaveBeenCalledWith("song-1");
		expect(result.wokeAccounts).toBe(1);
	});

	it("rejects an invalid YouTube URL before touching the database", async () => {
		await expect(
			submitManualUrl("song-1", "https://vimeo.com/watch?v=dQw4w9WgXcQ"),
		).rejects.toThrow(/Invalid YouTube URL/);
		expect(tx).not.toHaveBeenCalled();
		expect(wakeEnrichmentForSong).not.toHaveBeenCalled();
	});

	it("404s on an unknown song without enqueuing", async () => {
		vi.mocked(read).mockResolvedValueOnce([] as never);
		await expect(
			submitManualUrl("nope", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
		).rejects.toThrow(/Song not found/);
		expect(tx).not.toHaveBeenCalled();
	});
});

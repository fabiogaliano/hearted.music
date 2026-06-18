import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db");
vi.mock("@/lib/domains/enrichment/audio-feature-backfill/wake");

import { wakeEnrichmentForSong } from "@/lib/domains/enrichment/audio-feature-backfill/wake";
import {
	mapRow,
	parseYoutubeUrl,
	rejectAudioReview,
} from "../audio-feature-reviews";
import type { TxRun } from "../db";
import { tx } from "../db";

describe("parseYoutubeUrl host validation", () => {
	it("accepts canonical watch URLs and extracts the video id", () => {
		expect(parseYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual(
			{
				canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
				videoId: "dQw4w9WgXcQ",
			},
		);
	});

	it("accepts youtu.be short links", () => {
		expect(parseYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
			canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			videoId: "dQw4w9WgXcQ",
		});
	});

	it("accepts music.youtube.com and bare youtube.com", () => {
		expect(
			parseYoutubeUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ"),
		).not.toBeNull();
		expect(
			parseYoutubeUrl("https://youtube.com/watch?v=dQw4w9WgXcQ"),
		).not.toBeNull();
	});

	it("accepts /shorts/ URLs", () => {
		expect(parseYoutubeUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toEqual(
			{
				canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
				videoId: "dQw4w9WgXcQ",
			},
		);
	});

	it("normalizes extra query params to the canonical watch URL", () => {
		expect(
			parseYoutubeUrl(
				"https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=ABC&t=42s",
			)?.canonicalUrl,
		).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
	});

	it("rejects non-YouTube hosts", () => {
		expect(parseYoutubeUrl("https://vimeo.com/watch?v=dQw4w9WgXcQ")).toBeNull();
		expect(
			parseYoutubeUrl("https://notyoutube.com/watch?v=dQw4w9WgXcQ"),
		).toBeNull();
		// Subdomain spoofing must not pass the exact-host allow-list.
		expect(
			parseYoutubeUrl("https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ"),
		).toBeNull();
	});

	it("rejects non-http(s) schemes and malformed input", () => {
		expect(
			parseYoutubeUrl("javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ"),
		).toBeNull();
		expect(parseYoutubeUrl("not a url")).toBeNull();
		expect(parseYoutubeUrl("")).toBeNull();
	});

	it("rejects URLs without a valid 11-char video id", () => {
		expect(parseYoutubeUrl("https://www.youtube.com/watch?v=short")).toBeNull();
		expect(parseYoutubeUrl("https://www.youtube.com/feed/subscriptions")).toBeNull();
		expect(parseYoutubeUrl("https://youtu.be/")).toBeNull();
	});
});

describe("mapRow → UI shape", () => {
	const dbRow: Record<string, unknown> = {
		id: "rev-1",
		status: "pending",
		source_type: "youtube_search",
		created_at: "2026-06-15T10:00:00Z",
		song_id: "song-1",
		audio_feature_id: "feat-1",
		youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		youtube_video_id: "dQw4w9WgXcQ",
		youtube_title: "Some Song (Official Audio)",
		youtube_channel: "Some Artist",
		youtube_duration_seconds: 215,
		youtube_thumbnail_url: "https://img/thumb.jpg",
		search_query: "Some Artist Some Song",
		match_score: 0.91,
		match_reasons: ["title match", "duration within 3s"],
		clip_starts_seconds: [10, 90, 170],
		aggregation_metadata: { tempoConfidence: "low", tempoSpread: 0.3 },
		song_name: "Some Song",
		artists: ["Some Artist", "Featured"],
		album_name: "An Album",
		image_url: "https://img/cover.jpg",
		duration_ms: 215000,
		acousticness: 0.2,
		danceability: 0.7,
		energy: 0.65,
		instrumentalness: 0.01,
		liveness: 0.1,
		loudness: -7.3,
		speechiness: 0.05,
		tempo: 120.4,
		valence: 0.55,
	};

	it("maps snake_case DB columns to the camelCase UI shape", () => {
		const row = mapRow(dbRow);
		expect(row.id).toBe("rev-1");
		expect(row.songName).toBe("Some Song");
		expect(row.artists).toEqual(["Some Artist", "Featured"]);
		expect(row.albumName).toBe("An Album");
		expect(row.spotifyDurationMs).toBe(215000);
		expect(row.audioFeatureId).toBe("feat-1");
		expect(row.youtubeVideoId).toBe("dQw4w9WgXcQ");
		expect(row.youtubeDurationSeconds).toBe(215);
		expect(row.matchScore).toBeCloseTo(0.91);
		expect(row.matchReasons).toEqual(["title match", "duration within 3s"]);
		expect(row.clipStartsSeconds).toEqual([10, 90, 170]);
		expect(row.aggregationMetadata).toEqual({
			tempoConfidence: "low",
			tempoSpread: 0.3,
		});
		expect(row.tempo).toBeCloseTo(120.4);
		expect(row.loudness).toBeCloseTo(-7.3);
	});

	it("coerces nulls and missing optional columns without throwing", () => {
		const row = mapRow({
			id: "rev-2",
			status: "pending",
			source_type: "youtube_url",
			created_at: "2026-06-15T10:00:00Z",
			song_id: "song-2",
			audio_feature_id: null,
			song_name: "Bare",
			artists: null,
			match_reasons: null,
			clip_starts_seconds: null,
			aggregation_metadata: null,
		});
		expect(row.audioFeatureId).toBeNull();
		expect(row.artists).toEqual([]);
		expect(row.matchReasons).toEqual([]);
		expect(row.clipStartsSeconds).toEqual([]);
		expect(row.aggregationMetadata).toEqual({});
		expect(row.albumName).toBeNull();
		expect(row.tempo).toBeNull();
		expect(row.spotifyDurationMs).toBeNull();
	});

	// The live driver runs postgres.js with fetch_types:false, so array columns
	// arrive as raw Postgres array-literal STRINGS, not JS arrays. mapRow must
	// parse them — otherwise artists/reasons silently render empty in the panel.
	it("parses Postgres array-literal strings from the type-less driver", () => {
		const row = mapRow({
			...dbRow,
			artists: "{Oasis}",
			match_reasons: '{"title match","duration within 3s"}',
			clip_starts_seconds: "{10,90,170}",
		});
		expect(row.artists).toEqual(["Oasis"]);
		expect(row.matchReasons).toEqual(["title match", "duration within 3s"]);
		expect(row.clipStartsSeconds).toEqual([10, 90, 170]);
	});

	it("handles empty and comma-bearing array literals", () => {
		const row = mapRow({
			...dbRow,
			artists: '{"Tyler, The Creator","Kali Uchis"}',
			match_reasons: "{}",
		});
		expect(row.artists).toEqual(["Tyler, The Creator", "Kali Uchis"]);
		expect(row.matchReasons).toEqual([]);
	});
});

describe("rejectAudioReview state behavior", () => {
	let queries: string[];

	/** Drive rejectInTransaction's run() with canned rows and capture every SQL. */
	function stubTx(reviewRow: Record<string, unknown>) {
		queries = [];
		vi.mocked(tx).mockImplementation((async (
			fn: (run: TxRun) => Promise<unknown>,
		) => {
			const run: TxRun = (async (text: string) => {
				queries.push(text);
				if (
					/from public\.audio_feature_source_review/.test(text) &&
					/for update/.test(text)
				) {
					return [reviewRow];
				}
				if (/delete from public\.song_audio_feature/.test(text)) {
					return [{ id: "feat-1" }];
				}
				return [];
			}) as TxRun;
			return fn(run);
		}) as typeof tx);
		vi.mocked(wakeEnrichmentForSong).mockResolvedValue(["acc-1", "acc-2"]);
	}

	beforeEach(() => vi.clearAllMocks());

	it("marks the source job manual_needed so the song doesn't go absent and auto-search again", async () => {
		stubTx({
			song_id: "song-1",
			audio_feature_id: "feat-1",
			backfill_job_id: "job-1",
			created_at: "2026-06-15T10:00:00Z",
		});

		const result = await rejectAudioReview("rev-1", "operator", "wrong track");

		expect(result.ok).toBe(true);
		expect(result.songId).toBe("song-1");
		// The linked backfill job is terminalized to manual_needed (operator_rejected)
		// — audio_feature_state() then suppresses auto-retry but allows analysis.
		const jobUpdate = queries.find((q) =>
			/update public\.audio_feature_backfill_job/.test(q),
		);
		expect(jobUpdate).toBeDefined();
		expect(jobUpdate).toMatch(/manual_needed/);
		expect(jobUpdate).toMatch(/operator_rejected/);
		// And it must not clobber an active replacement job.
		expect(jobUpdate).toMatch(/status not in \('pending', 'running'\)/);
		// Wake fires after commit so the song re-analyzes.
		expect(wakeEnrichmentForSong).toHaveBeenCalledWith("song-1");
		expect(result.wokeAccounts).toBe(2);
	});

	it("still deletes the exact feature row and rejects the review", async () => {
		stubTx({
			song_id: "song-1",
			audio_feature_id: "feat-1",
			backfill_job_id: "job-1",
			created_at: "2026-06-15T10:00:00Z",
		});

		const result = await rejectAudioReview("rev-1", "operator", null);

		expect(result.deletedFeatures).toBe(1);
		expect(
			queries.some((q) => /delete from public\.song_audio_feature/.test(q)),
		).toBe(true);
		expect(
			queries.some(
				(q) =>
					/update public\.audio_feature_source_review/.test(q) &&
					/'rejected'/.test(q),
			),
		).toBe(true);
	});
});

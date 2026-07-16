import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db");

import type { YoutubeCandidate } from "@/lib/integrations/youtube-audio/types";
import type { AudioFeatureCandidate } from "../audio-candidates";
import { read } from "../db";
import { HttpError } from "../http-error";
import {
	audioSourcesForInstrumentalReview,
	sourcesFromMatch,
	sourcesFromSearch,
} from "../instrumental-audio";

const readMock = vi.mocked(read);

function candidate(
	overrides: Partial<AudioFeatureCandidate>,
): AudioFeatureCandidate {
	return {
		videoId: "v1",
		url: "https://www.youtube.com/watch?v=v1",
		title: "Song (Official Audio)",
		channel: "Channel",
		durationSeconds: 200,
		thumbnailUrl: null,
		score: 0.9,
		reasons: [],
		rejected: false,
		rejectReason: null,
		rank: 1,
		...overrides,
	};
}

function ytCandidate(overrides: Partial<YoutubeCandidate>): YoutubeCandidate {
	return {
		videoId: "s1",
		url: "https://www.youtube.com/watch?v=s1",
		title: "Search hit",
		channel: null,
		durationSeconds: null,
		thumbnailUrl: null,
		...overrides,
	};
}

const MATCH = {
	videoId: "match",
	title: "Matched upload",
	channel: "Label",
	durationSeconds: 201,
};

describe("sourcesFromMatch", () => {
	it("puts the accepted match first and fills with non-rejected alternates", () => {
		const sources = sourcesFromMatch(MATCH, [
			candidate({ videoId: "match" }),
			candidate({ videoId: "alt1" }),
			candidate({ videoId: "rej", rejected: true }),
			candidate({ videoId: "alt2" }),
			candidate({ videoId: "alt3" }),
		]);
		expect(sources.map((s) => s.videoId)).toEqual(["match", "alt1", "alt2"]);
		expect(sources[0]?.title).toBe("Matched upload");
	});

	it("dedupes candidates that repeat the match's video id", () => {
		const sources = sourcesFromMatch(MATCH, [candidate({ videoId: "match" })]);
		expect(sources).toHaveLength(1);
	});
});

describe("sourcesFromSearch", () => {
	it("caps at three deduped results", () => {
		const sources = sourcesFromSearch([
			ytCandidate({ videoId: "a" }),
			ytCandidate({ videoId: "a" }),
			ytCandidate({ videoId: "b" }),
			ytCandidate({ videoId: "c" }),
			ytCandidate({ videoId: "d" }),
		]);
		expect(sources.map((s) => s.videoId)).toEqual(["a", "b", "c"]);
	});
});

describe("audioSourcesForInstrumentalReview", () => {
	beforeEach(() => {
		readMock.mockReset();
	});

	it("throws 404 when the review does not exist", async () => {
		readMock.mockResolvedValueOnce([]);
		await expect(
			audioSourcesForInstrumentalReview("missing"),
		).rejects.toMatchObject({ status: 404 });
	});

	it("reuses a stored audio-pipeline match, clip offsets included", async () => {
		readMock
			.mockResolvedValueOnce([
				{ song_id: "song-match", name: "Piano Piece", artist_label: "Ludovico" },
			])
			.mockResolvedValueOnce([
				{
					youtube_video_id: "match",
					youtube_title: "Matched upload",
					youtube_channel: "Label",
					youtube_duration_seconds: "201",
					// numeric[] arrives as a raw literal via the type-less pooler driver.
					clip_starts_seconds: "{30,90,150}",
					candidates: [candidate({ videoId: "alt1" })],
				},
			]);
		const search = vi.fn();

		const result = await audioSourcesForInstrumentalReview("rev-match", search);
		expect(result.origin).toBe("match");
		expect(result.clipStarts).toEqual([30, 90, 150]);
		expect(result.sources.map((s) => s.videoId)).toEqual(["match", "alt1"]);
		expect(result.sources[0]?.durationSeconds).toBe(201);
		expect(search).not.toHaveBeenCalled();
	});

	it("falls back to a live search built from the primary artist", async () => {
		readMock
			.mockResolvedValueOnce([
				{
					song_id: "song-search",
					name: "Interlude",
					artist_label: "Duo A, Guest B",
				},
			])
			.mockResolvedValueOnce([]);
		const search = vi.fn(async () => [ytCandidate({ videoId: "hit" })]);

		const result = await audioSourcesForInstrumentalReview("rev-search", search);
		expect(search).toHaveBeenCalledWith("Duo A Interlude audio");
		expect(result.origin).toBe("search");
		expect(result.searchQuery).toBe("Duo A Interlude audio");
		expect(result.clipStarts).toEqual([]);
		expect(result.sources.map((s) => s.videoId)).toEqual(["hit"]);
	});

	it("retries with the title suffix stripped when the first search is empty", async () => {
		readMock
			.mockResolvedValueOnce([
				{
					song_id: "song-suffix",
					name: "Poongnyeon - New Version",
					artist_label: "Park Kyoung Hoon",
				},
			])
			.mockResolvedValueOnce([]);
		const search = vi
			.fn(async () => [ytCandidate({ videoId: "hit" })])
			.mockResolvedValueOnce([]);

		const result = await audioSourcesForInstrumentalReview("rev-suffix", search);
		expect(search).toHaveBeenNthCalledWith(
			1,
			"Park Kyoung Hoon Poongnyeon - New Version audio",
		);
		expect(search).toHaveBeenNthCalledWith(2, "Park Kyoung Hoon Poongnyeon audio");
		expect(result.searchQuery).toBe("Park Kyoung Hoon Poongnyeon audio");
		expect(result.sources.map((s) => s.videoId)).toEqual(["hit"]);
	});

	it("propagates a search failure as an HttpError", async () => {
		readMock
			.mockResolvedValueOnce([
				{ song_id: "song-fail", name: "Interlude", artist_label: "Duo" },
			])
			.mockResolvedValueOnce([]);
		const search = vi.fn(async () => {
			throw new HttpError(502, "YouTube search failed");
		});
		await expect(
			audioSourcesForInstrumentalReview("rev-fail", search),
		).rejects.toBeInstanceOf(HttpError);
	});
});

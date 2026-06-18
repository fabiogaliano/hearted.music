import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acquireSource } from "../service";
import type { ProbeResult, YoutubeCandidate } from "../types";

vi.mock("../yt-dlp");
vi.mock("../ffmpeg");

import { extractClips, probeAndValidate } from "../ffmpeg";
import { downloadAudio, hydrateCandidate, searchYouTube } from "../yt-dlp";

const SONG = {
	name: "Song",
	artists: ["Artist"],
	albumName: "Album",
	durationMs: 200_000,
	spotifyId: "sp",
};

/** A flat search hit: a video id but no reliable duration/channel yet. */
function flat(videoId: string): YoutubeCandidate {
	return {
		videoId,
		url: `https://www.youtube.com/watch?v=${videoId}`,
		title: videoId,
		channel: null,
		durationSeconds: null,
		thumbnailUrl: null,
	};
}

/** A hydrated hit: full metadata that scores as a strong official match. */
function strong(videoId: string): YoutubeCandidate {
	return {
		videoId,
		url: `https://www.youtube.com/watch?v=${videoId}`,
		title: "Artist - Song (Official Audio)",
		channel: "Artist - Topic",
		durationSeconds: 200,
		thumbnailUrl: "thumb",
	};
}

const PROBE: ProbeResult = {
	durationSeconds: 200,
	hasAudioStream: true,
	sizeBytes: 1_000_000,
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(downloadAudio).mockResolvedValue(Result.ok("/tmp/job/source.webm"));
	vi.mocked(probeAndValidate).mockResolvedValue(Result.ok(PROBE));
	vi.mocked(extractClips).mockResolvedValue(
		Result.ok([
			{ path: "/tmp/job/clip_0.mp3", startSeconds: 0, durationSeconds: 30 },
		]),
	);
});

describe("acquireSource youtube_search hydration", () => {
	it("hydrates every search candidate before scoring, then downloads the winner", async () => {
		vi.mocked(searchYouTube).mockResolvedValue(
			Result.ok([flat("aaaaaaaaaaa")]),
		);
		vi.mocked(hydrateCandidate).mockResolvedValue(
			Result.ok(strong("aaaaaaaaaaa")),
		);

		const result = await acquireSource({
			sourceType: "youtube_search",
			sourceUrl: null,
			song: SONG,
			jobDir: "/tmp/job",
		});

		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) throw result.error;
		expect(result.value.kind).toBe("acquired");
		// Scoring ran against hydrated metadata, not the bare flat hit.
		expect(hydrateCandidate).toHaveBeenCalledWith("aaaaaaaaaaa", undefined);
		expect(downloadAudio).toHaveBeenCalledWith(
			"https://www.youtube.com/watch?v=aaaaaaaaaaa",
			"/tmp/job",
			undefined,
		);
	});

	it("drops candidates that fail to hydrate as long as one survives", async () => {
		vi.mocked(searchYouTube).mockResolvedValue(
			Result.ok([flat("failsfailsf"), flat("bbbbbbbbbbb")]),
		);
		vi.mocked(hydrateCandidate).mockImplementation(async (videoId: string) =>
			videoId === "failsfailsf"
				? Result.err(
						new (
							await import("@/lib/shared/errors/external/youtube-audio")
						).YtDlpError({ message: "hydrate failed", code: "nonzero_exit" }),
					)
				: Result.ok(strong("bbbbbbbbbbb")),
		);

		const result = await acquireSource({
			sourceType: "youtube_search",
			sourceUrl: null,
			song: SONG,
			jobDir: "/tmp/job",
		});

		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) throw result.error;
		expect(result.value.kind).toBe("acquired");
		expect(hydrateCandidate).toHaveBeenCalledTimes(2);
		// The surviving hydrated candidate is the one downloaded.
		expect(downloadAudio).toHaveBeenCalledWith(
			"https://www.youtube.com/watch?v=bbbbbbbbbbb",
			"/tmp/job",
			undefined,
		);
	});

	it("threads the egress proxy through search, hydrate, and download", async () => {
		vi.mocked(searchYouTube).mockResolvedValue(
			Result.ok([flat("aaaaaaaaaaa")]),
		);
		vi.mocked(hydrateCandidate).mockResolvedValue(
			Result.ok(strong("aaaaaaaaaaa")),
		);

		const result = await acquireSource({
			sourceType: "youtube_search",
			sourceUrl: null,
			song: SONG,
			jobDir: "/tmp/job",
			proxy: "socks5://warp:1080",
		});

		expect(Result.isOk(result)).toBe(true);
		expect(searchYouTube).toHaveBeenCalledWith(
			expect.any(String),
			undefined,
			"socks5://warp:1080",
		);
		expect(hydrateCandidate).toHaveBeenCalledWith(
			"aaaaaaaaaaa",
			"socks5://warp:1080",
		);
		expect(downloadAudio).toHaveBeenCalledWith(
			"https://www.youtube.com/watch?v=aaaaaaaaaaa",
			"/tmp/job",
			"socks5://warp:1080",
		);
	});

	it("returns a typed hydrate_failed error when every candidate fails to hydrate", async () => {
		const { YtDlpError } = await import(
			"@/lib/shared/errors/external/youtube-audio"
		);
		vi.mocked(searchYouTube).mockResolvedValue(
			Result.ok([flat("ccccccccccc"), flat("ddddddddddd")]),
		);
		vi.mocked(hydrateCandidate).mockResolvedValue(
			Result.err(new YtDlpError({ message: "down", code: "nonzero_exit" })),
		);

		const result = await acquireSource({
			sourceType: "youtube_search",
			sourceUrl: null,
			song: SONG,
			jobDir: "/tmp/job",
		});

		expect(Result.isError(result)).toBe(true);
		if (Result.isOk(result)) throw new Error("expected error");
		expect(result.error.code).toBe("hydrate_failed");
		// Never auto-inserts off weak flat data.
		expect(downloadAudio).not.toHaveBeenCalled();
	});
});

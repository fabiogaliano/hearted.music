import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../spawn");

import { runCommand } from "../spawn";
import {
	buildProxyArgs,
	parseSearchOutput,
	parseVideoJson,
	searchYouTube,
	summarizeYtDlpFailure,
} from "../yt-dlp";

describe("parseSearchOutput", () => {
	it("parses a single object with an entries array", () => {
		const out = parseSearchOutput(
			JSON.stringify({
				entries: [
					{
						id: "v1",
						title: "A",
						duration: 200,
						channel: "C",
						thumbnails: [{ url: "t1" }, { url: "t2" }],
					},
					{ id: "v2", title: "B", uploader: "U2", duration: null },
				],
			}),
		);
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({
			videoId: "v1",
			title: "A",
			channel: "C",
			durationSeconds: 200,
			thumbnailUrl: "t2",
		});
		expect(out[0]?.url).toContain("watch?v=v1");
		expect(out[1]).toMatchObject({
			videoId: "v2",
			channel: "U2",
			durationSeconds: null,
		});
	});

	it("falls back to newline-delimited JSON objects", () => {
		const text = [
			JSON.stringify({ id: "v1", title: "A", duration: 200, channel: "C" }),
			JSON.stringify({ id: "v2", title: "B", uploader: "U2" }),
		].join("\n");
		const out = parseSearchOutput(text);
		expect(out.map((c) => c.videoId)).toEqual(["v1", "v2"]);
	});

	it("returns no candidates for empty or entry-less output", () => {
		expect(parseSearchOutput("")).toEqual([]);
		expect(parseSearchOutput("   \n  ")).toEqual([]);
		expect(parseSearchOutput("{}")).toEqual([]);
		expect(parseSearchOutput(JSON.stringify({ entries: [] }))).toEqual([]);
	});

	it("skips entries without a usable id", () => {
		const out = parseSearchOutput(
			JSON.stringify({ entries: [{ title: "no id" }, { id: "ok" }] }),
		);
		expect(out.map((c) => c.videoId)).toEqual(["ok"]);
	});

	it("parses YouTube Music song-shelf video entries and skips browse entities", () => {
		const out = parseSearchOutput(
			JSON.stringify({
				entries: [
					{
						id: "J7p4bzqLvCw",
						title: "Blinding Lights",
						url: "https://music.youtube.com/watch?v=J7p4bzqLvCw",
					},
					{
						id: "UClYV6hHlupm_S_ObS1W-DYw",
						title: null,
						url: "https://music.youtube.com/browse/UClYV6hHlupm_S_ObS1W-DYw",
					},
				],
			}),
		);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			videoId: "J7p4bzqLvCw",
			title: "Blinding Lights",
			channel: null,
			durationSeconds: null,
			url: "https://www.youtube.com/watch?v=J7p4bzqLvCw",
		});
	});
});

const EMPTY_SEARCH = {
	stdout: JSON.stringify({ entries: [] }),
	stderr: "",
	exitCode: 0,
	timedOut: false,
};

const ONE_SEARCH_RESULT = {
	stdout: JSON.stringify({ entries: [{ id: "result", title: "Song" }] }),
	stderr: "",
	exitCode: 0,
	timedOut: false,
};

describe("searchYouTube", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses the YouTube Music Songs shelf and falls back when it is empty", async () => {
		vi.mocked(runCommand)
			.mockResolvedValueOnce(EMPTY_SEARCH)
			.mockResolvedValueOnce(ONE_SEARCH_RESULT);

		const result = await searchYouTube("Artist Song", 3);
		if (Result.isError(result)) throw result.error;

		expect(result.value).toHaveLength(1);
		expect(runCommand).toHaveBeenNthCalledWith(
			1,
			expect.arrayContaining([
				"--playlist-end",
				"3",
				"https://music.youtube.com/search?q=Artist%20Song&sp=EgWKAQIIAWoKEAoQAxAEEAkQBQ%3D%3D",
			]),
			expect.any(Object),
		);
		expect(runCommand).toHaveBeenNthCalledWith(
			2,
			expect.arrayContaining(["ytsearch3:Artist Song"]),
			expect.any(Object),
		);
	});

	it("falls back to regular YouTube when the Music extractor errors", async () => {
		vi.mocked(runCommand)
			.mockResolvedValueOnce({
				stdout: "",
				stderr: "Music extractor failed",
				exitCode: 1,
				timedOut: false,
			})
			.mockResolvedValueOnce(ONE_SEARCH_RESULT);

		const result = await searchYouTube("Artist Song", 3);
		if (Result.isError(result)) throw result.error;

		expect(result.value).toHaveLength(1);
		expect(runCommand).toHaveBeenCalledTimes(2);
	});
});

describe("parseVideoJson", () => {
	it("parses a hydrated video object", () => {
		const c = parseVideoJson(
			JSON.stringify({
				id: "vid",
				title: "Song",
				channel: "Chan",
				duration: 180,
				webpage_url: "https://www.youtube.com/watch?v=vid",
				thumbnail: "thumb",
			}),
		);
		expect(c).toMatchObject({
			videoId: "vid",
			title: "Song",
			channel: "Chan",
			durationSeconds: 180,
			url: "https://www.youtube.com/watch?v=vid",
			thumbnailUrl: "thumb",
		});
	});

	it("returns null for unparseable or id-less JSON", () => {
		expect(parseVideoJson("not json")).toBeNull();
		expect(parseVideoJson("{}")).toBeNull();
	});
});

describe("summarizeYtDlpFailure", () => {
	it("prefers the ERROR line over surrounding warnings", () => {
		const stderr = [
			"WARNING: [youtube] vid: nsig extraction failed",
			"ERROR: [youtube] vid: Sign in to confirm you're not a bot. Use --cookies-from-browser",
			"",
		].join("\n");
		expect(summarizeYtDlpFailure(stderr)).toBe(
			"ERROR: [youtube] vid: Sign in to confirm you're not a bot. Use --cookies-from-browser",
		);
	});

	it("falls back to the last non-empty line when no ERROR line exists", () => {
		expect(summarizeYtDlpFailure("first\nsecond\n  \n")).toBe("second");
	});

	it("returns null for empty or whitespace-only stderr", () => {
		expect(summarizeYtDlpFailure(undefined)).toBeNull();
		expect(summarizeYtDlpFailure("")).toBeNull();
		expect(summarizeYtDlpFailure("   \n  ")).toBeNull();
	});

	it("caps overly long lines with an ellipsis", () => {
		const long = `ERROR: ${"x".repeat(400)}`;
		const out = summarizeYtDlpFailure(long);
		expect(out).toHaveLength(300);
		expect(out?.endsWith("…")).toBe(true);
	});
});

describe("buildProxyArgs", () => {
	it("returns --proxy args when a proxy is set", () => {
		expect(buildProxyArgs("socks5://warp:1080")).toEqual([
			"--proxy",
			"socks5://warp:1080",
		]);
	});

	it("trims surrounding whitespace", () => {
		expect(buildProxyArgs("  http://p:3128  ")).toEqual([
			"--proxy",
			"http://p:3128",
		]);
	});

	it("returns [] when unset, empty, or whitespace-only", () => {
		expect(buildProxyArgs(undefined)).toEqual([]);
		expect(buildProxyArgs("")).toEqual([]);
		expect(buildProxyArgs("   ")).toEqual([]);
	});
});

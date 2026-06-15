import { describe, expect, it } from "vitest";
import { parseSearchOutput, parseVideoJson } from "../yt-dlp";

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

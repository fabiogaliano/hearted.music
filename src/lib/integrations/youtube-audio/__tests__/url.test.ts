import { describe, expect, it } from "vitest";
import { extractYoutubeVideoId } from "../url";

describe("extractYoutubeVideoId", () => {
	it.each([
		["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		["https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=3", "dQw4w9WgXcQ"],
	])("accepts %s", (url, id) => {
		const parsed = extractYoutubeVideoId(url);
		expect(parsed?.videoId).toBe(id);
		expect(parsed?.canonicalUrl).toBe(`https://www.youtube.com/watch?v=${id}`);
	});

	it.each([
		"https://vimeo.com/123",
		"https://evil.com/watch?v=dQw4w9WgXcQ",
		"https://www.youtube.com/watch",
		"not a url",
		"ftp://youtu.be/abc",
	])("rejects %s", (url) => {
		expect(extractYoutubeVideoId(url)).toBeNull();
	});
});

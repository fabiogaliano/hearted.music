import { describe, expect, it } from "vitest";
import { extractYoutubeVideoId } from "../url";

describe("extractYoutubeVideoId", () => {
	it.each([
		["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		["https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=3", "dQw4w9WgXcQ"],
		// /embed/ path (previously missing from control-panel parser)
		["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		// m.youtube.com with /embed/ (double-coverage of both additions)
		["https://m.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		// id at the 6-char minimum boundary (valid per 6-20 rule)
		["https://www.youtube.com/watch?v=abc123", "abc123"],
		// id at the 20-char maximum boundary (valid per 6-20 rule)
		[
			"https://www.youtube.com/watch?v=abcdefghijklmnopqrst",
			"abcdefghijklmnopqrst",
		],
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
		// id too short (5 chars, below 6-char minimum)
		"https://www.youtube.com/watch?v=ab123",
		// id too long (21 chars, above 20-char maximum)
		"https://www.youtube.com/watch?v=abcdefghijklmnopqrstu",
	])("rejects %s", (url) => {
		expect(extractYoutubeVideoId(url)).toBeNull();
	});
});

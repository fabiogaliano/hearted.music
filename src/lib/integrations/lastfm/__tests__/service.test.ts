import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LastFmNotFoundError } from "@/lib/shared/errors/external/lastfm";
import { LastFmService } from "../service";

function jsonResponse(body: unknown) {
	return {
		ok: true,
		status: 200,
		statusText: "OK",
		headers: { get: () => null },
		json: async () => body,
	} as unknown as Response;
}

// Last.fm returns HTTP 200 with an { error, message } body for failures.
const RATE_LIMIT_BODY = { error: 29, message: "Rate limit exceeded" };
const NOT_FOUND_BODY = { error: 6, message: "Artist not found" };
const TAGS_BODY = {
	toptags: {
		tag: [{ name: "rock", count: 90, url: "https://last.fm/tag/rock" }],
		"@attr": { artist: "Test Artist" },
	},
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("LastFmService retry behavior", () => {
	it("retries a rate-limit (error 29) and then succeeds", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(RATE_LIMIT_BODY))
			.mockResolvedValueOnce(jsonResponse(TAGS_BODY));
		vi.stubGlobal("fetch", fetchMock);

		const result = await new LastFmService("test-key").getArtistTopTags(
			"Test Artist",
		);

		expect(Result.isOk(result)).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("retries a network failure (thrown fetch) and then succeeds", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error("ECONNRESET"))
			.mockResolvedValueOnce(jsonResponse(TAGS_BODY));
		vi.stubGlobal("fetch", fetchMock);

		const result = await new LastFmService("test-key").getArtistTopTags(
			"Test Artist",
		);

		expect(Result.isOk(result)).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("does not retry a not-found (error 6)", async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOT_FOUND_BODY));
		vi.stubGlobal("fetch", fetchMock);

		const result = await new LastFmService("test-key").getArtistTopTags(
			"Unknown Artist",
		);

		expect(Result.isError(result)).toBe(true);
		expect(Result.isError(result) && result.error).toBeInstanceOf(
			LastFmNotFoundError,
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

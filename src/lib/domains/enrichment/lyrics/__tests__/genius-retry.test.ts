import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LyricsService } from "../service";
import { generateQueryVariants } from "../utils/search-strategy";

// Search tries every query variant, each its own retryable request. Deriving
// the count from the real generator keeps assertions honest if the strategy
// changes.
const VARIANT_COUNT = generateQueryVariants("Artist", "Song").length;

function errorResponse(status: number) {
	return {
		ok: false,
		status,
		statusText: `status ${status}`,
		json: async () => ({}),
	} as unknown as Response;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("LyricsService search retry behavior", () => {
	it("retries transient 5xx search failures (bounded) before giving up", async () => {
		const fetchMock = vi.fn().mockResolvedValue(errorResponse(503));
		vi.stubGlobal("fetch", fetchMock);

		const service = new LyricsService({ accessToken: "test-token" });
		const promise = service.getLyrics("Artist", "Song");
		await vi.runAllTimersAsync();
		const result = await promise;

		expect(Result.isError(result)).toBe(true);
		// maxRetries (2) + initial attempt = 3 requests per variant.
		expect(fetchMock).toHaveBeenCalledTimes(VARIANT_COUNT * 3);
	});

	it("does not retry deterministic 4xx search failures", async () => {
		const fetchMock = vi.fn().mockResolvedValue(errorResponse(401));
		vi.stubGlobal("fetch", fetchMock);

		const service = new LyricsService({ accessToken: "test-token" });
		const promise = service.getLyrics("Artist", "Song");
		await vi.runAllTimersAsync();
		const result = await promise;

		expect(Result.isError(result)).toBe(true);
		// One request per variant — no retry on a 4xx.
		expect(fetchMock).toHaveBeenCalledTimes(VARIANT_COUNT);
	});
});

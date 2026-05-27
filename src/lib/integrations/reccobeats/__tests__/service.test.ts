import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReccoBeatsService } from "../service";

interface MockResponseInit {
	status?: number;
	body?: unknown;
	statusText?: string;
	headers?: Record<string, string>;
}

function mockResponse({
	status = 200,
	body,
	statusText = "",
	headers = {},
}: MockResponseInit) {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText,
		headers: {
			get: (key: string) => headers[key] ?? headers[key.toLowerCase()] ?? null,
		},
		json: async () => body,
	} as unknown as Response;
}

const ID_LOOKUP_BODY = { content: [{ id: "rb-1" }] };
const FEATURES_BODY = {
	id: "rb-1",
	acousticness: 0.5,
	danceability: 0.5,
	energy: 0.5,
	instrumentalness: 0.1,
	liveness: 0.1,
	loudness: -8,
	speechiness: 0.05,
	tempo: 120,
	valence: 0.5,
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("ReccoBeatsService retry behavior", () => {
	it("retries a transient 5xx and then succeeds", async () => {
		const fetchMock = vi
			.fn()
			// id lookup: 503 then 200
			.mockResolvedValueOnce(mockResponse({ status: 503, statusText: "down" }))
			.mockResolvedValueOnce(mockResponse({ body: ID_LOOKUP_BODY }))
			// audio-features lookup: 200
			.mockResolvedValueOnce(mockResponse({ body: FEATURES_BODY }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await new ReccoBeatsService().getAudioFeatures("sp-1");

		expect(Result.isOk(result)).toBe(true);
		expect(Result.isOk(result) && result.value?.id).toBe("rb-1");
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("does not retry a not-found (404)", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(mockResponse({ status: 404, statusText: "missing" }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await new ReccoBeatsService().getAudioFeatures("sp-1");

		// Not-found surfaces as ok(null) from the public API, but the key
		// assertion is that we made exactly one request — no retry.
		expect(Result.isOk(result) && result.value).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("gives up after the bounded number of retries on persistent 5xx", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(mockResponse({ status: 503, statusText: "down" }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await new ReccoBeatsService().getAudioFeaturesBatch([
			"sp-1",
		]);

		expect(Result.isOk(result)).toBe(true);
		expect(Result.isOk(result) && result.value.failures.get("sp-1")).toBe(
			"transient",
		);
		// maxRetries (2) + initial attempt = 3 requests, all on the id lookup.
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});

import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import {
	SpotifyApiError,
	SpotifyAuthError,
	SpotifyRateLimitError,
} from "@/lib/shared/errors/external/spotify";
import { classifySpotifyError, fetchOnce, fetchWithRetry } from "./request";

describe("classifySpotifyError", () => {
	it("classifies 429 as SpotifyRateLimitError", () => {
		const error = { status: 429, headers: { get: () => "5" } };
		const result = classifySpotifyError(error);

		expect(result).toBeInstanceOf(SpotifyRateLimitError);
		if (result instanceof SpotifyRateLimitError) {
			expect(result.retryAfterMs).toBe(5000);
		}
	});

	it("classifies 401 as SpotifyAuthError (expired)", () => {
		const error = { status: 401 };
		const result = classifySpotifyError(error);

		expect(result).toBeInstanceOf(SpotifyAuthError);
		if (result instanceof SpotifyAuthError) {
			expect(result.reason).toBe("expired");
		}
	});

	it("classifies 403 as SpotifyAuthError (revoked)", () => {
		const error = { status: 403 };
		const result = classifySpotifyError(error);

		expect(result).toBeInstanceOf(SpotifyAuthError);
		if (result instanceof SpotifyAuthError) {
			expect(result.reason).toBe("revoked");
		}
	});

	it("classifies 404 as SpotifyNotFoundError", () => {
		const error = { status: 404 };
		const result = classifySpotifyError(error);

		expect(result._tag).toBe("SpotifyNotFoundError");
	});

	it("classifies other status codes as SpotifyApiError", () => {
		const error = { status: 500, message: "Internal Server Error" };
		const result = classifySpotifyError(error);

		expect(result).toBeInstanceOf(SpotifyApiError);
		if (result instanceof SpotifyApiError) {
			expect(result.status).toBe(500);
		}
	});

	it("handles Error instances", () => {
		const error = new Error("Network failure");
		const result = classifySpotifyError(error);

		expect(result).toBeInstanceOf(SpotifyApiError);
		expect(result.message).toBe("Network failure");
	});
});

describe("fetchWithRetry", () => {
	it("returns Ok on successful fetch", async () => {
		const fetchFn = vi.fn().mockResolvedValue({ data: "test" });

		const result = await fetchWithRetry(fetchFn);

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value).toEqual({ data: "test" });
		}
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("retries on rate limit error", async () => {
		const rateLimitError = { status: 429, headers: { get: () => "0" } };
		const fetchFn = vi
			.fn()
			.mockRejectedValueOnce(rateLimitError)
			.mockResolvedValueOnce({ data: "success" });

		const result = await fetchWithRetry(fetchFn);

		expect(Result.isOk(result)).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it("does not retry on auth error", async () => {
		const authError = { status: 401 };
		const fetchFn = vi.fn().mockRejectedValue(authError);

		const result = await fetchWithRetry(fetchFn);

		expect(Result.isError(result)).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("respects maxRetries option", async () => {
		const rateLimitError = { status: 429, headers: { get: () => "0" } };
		const fetchFn = vi.fn().mockRejectedValue(rateLimitError);

		const result = await fetchWithRetry(fetchFn, { maxRetries: 2 });

		expect(Result.isError(result)).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(3); // initial + 2 retries
	});
});

describe("fetchOnce", () => {
	it("returns Ok on success without retry", async () => {
		const fetchFn = vi.fn().mockResolvedValue({ data: "test" });

		const result = await fetchOnce(fetchFn);

		expect(Result.isOk(result)).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("returns Err on failure without retry", async () => {
		const error = { status: 429 };
		const fetchFn = vi.fn().mockRejectedValue(error);

		const result = await fetchOnce(fetchFn);

		expect(Result.isError(result)).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});

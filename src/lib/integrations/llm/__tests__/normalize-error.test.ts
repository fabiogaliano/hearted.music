import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { classifyAnalysisFailure } from "@/lib/domains/enrichment/content-analysis/failure-classification";
import {
	isRetryableLlmError,
	LlmProviderError,
	LlmRateLimitError,
} from "@/lib/shared/errors/external/llm";
import { normalizeLlmError } from "../service";

function apiCallError(opts: {
	message: string;
	statusCode?: number;
	responseHeaders?: Record<string, string>;
	isRetryable?: boolean;
}): APICallError {
	return new APICallError({
		message: opts.message,
		url: "https://vertex.example/generate",
		requestBodyValues: {},
		statusCode: opts.statusCode,
		responseHeaders: opts.responseHeaders,
		isRetryable: opts.isRetryable,
	});
}

describe("normalizeLlmError", () => {
	it("unwraps an SDK RetryError so an exhausted 429 stays a rate limit, not terminal", () => {
		// The original bug: the SDK's internal retries exhausted on a Vertex 429
		// and wrapped it as "Failed after 3 attempts", which the old normalizer
		// read as a status-less provider error -> permanent -> terminal.
		const wrapped = new RetryError({
			message: "Failed after 3 attempts. Last error: RESOURCE_EXHAUSTED",
			reason: "maxRetriesExceeded",
			errors: [
				apiCallError({ message: "RESOURCE_EXHAUSTED", statusCode: 429 }),
			],
		});

		const normalized = normalizeLlmError(
			wrapped,
			"google-vertex",
			"gemini-2.5-flash",
		);

		expect(normalized).toBeInstanceOf(LlmRateLimitError);
		expect(isRetryableLlmError(normalized)).toBe(true);
		expect(classifyAnalysisFailure(normalized)).toMatchObject({
			isRetryable: true,
			cause: "llm_rate_limit",
		});
	});

	it("maps a raw 429 APICallError to a rate limit with the Retry-After floor", () => {
		const normalized = normalizeLlmError(
			apiCallError({
				message: "Too Many Requests",
				statusCode: 429,
				responseHeaders: { "retry-after": "12" },
			}),
			"google-vertex",
			"gemini-2.5-flash",
		);

		expect(normalized).toBeInstanceOf(LlmRateLimitError);
		expect(classifyAnalysisFailure(normalized)).toMatchObject({
			isRetryable: true,
			cause: "llm_rate_limit",
			retryAfterMs: 12_000,
		});
	});

	it("detects Vertex resource-exhausted phrasing even without a 429 status", () => {
		const normalized = normalizeLlmError(
			apiCallError({
				message: "Resource has been exhausted (e.g. check quota).",
			}),
			"google-vertex",
			"gemini-2.5-flash",
		);

		expect(normalized).toBeInstanceOf(LlmRateLimitError);
	});

	it("carries the SDK's retryable verdict for status-less transients", () => {
		// Connection reset: no HTTP status, but the SDK deems it retryable. Once we
		// own retrying, our status-based rules can't see this without the verdict.
		const normalized = normalizeLlmError(
			apiCallError({ message: "fetch failed: ECONNRESET", isRetryable: true }),
			"google-vertex",
			"gemini-2.5-flash",
		);

		expect(normalized).toBeInstanceOf(LlmProviderError);
		if (normalized instanceof LlmProviderError) {
			expect(normalized.retryable).toBe(true);
		}
		expect(isRetryableLlmError(normalized)).toBe(true);
	});

	it("keeps 5xx retryable and deterministic 4xx terminal", () => {
		const serverError = normalizeLlmError(
			apiCallError({ message: "Internal Server Error", statusCode: 503 }),
			"google-vertex",
			"gemini-2.5-flash",
		);
		expect(isRetryableLlmError(serverError)).toBe(true);

		const badRequest = normalizeLlmError(
			apiCallError({ message: "Invalid argument", statusCode: 400 }),
			"google-vertex",
			"gemini-2.5-flash",
		);
		expect(badRequest).toBeInstanceOf(LlmProviderError);
		expect(isRetryableLlmError(badRequest)).toBe(false);
		expect(classifyAnalysisFailure(badRequest)).toMatchObject({
			isRetryable: false,
			cause: "llm_provider",
			statusCode: 400,
		});
	});

	it("treats an unparseable structured response (NoObjectGenerated) as retryable", () => {
		const normalized = normalizeLlmError(
			new Error("No object generated: response did not match schema"),
			"google-vertex",
			"gemini-2.5-flash",
		);

		expect(normalized).toBeInstanceOf(LlmProviderError);
		expect(isRetryableLlmError(normalized)).toBe(true);
	});

	it("falls back to a terminal provider error for unknown shapes", () => {
		const normalized = normalizeLlmError(
			"some non-error value",
			"google-vertex",
			"gemini-2.5-flash",
		);

		expect(normalized).toBeInstanceOf(LlmProviderError);
		expect(isRetryableLlmError(normalized)).toBe(false);
	});
});

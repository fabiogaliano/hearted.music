import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../generic";

class TestRetryableError extends Error {
	retryAfterMs?: number;
	constructor(message: string, retryAfterMs?: number) {
		super(message);
		this.retryAfterMs = retryAfterMs;
	}
}

class TestPermanentError extends Error {}

describe("withRetry", () => {
	it("returns immediately on success", async () => {
		const op = vi.fn().mockResolvedValue(Result.ok("done"));

		const result = await withRetry(op, { maxRetries: 2 });

		expect(Result.isOk(result) && result.value).toBe("done");
		expect(op).toHaveBeenCalledOnce();
	});

	it("retries on retryable errors up to maxRetries", async () => {
		const error = new TestRetryableError("transient");
		const op = vi
			.fn()
			.mockResolvedValueOnce(Result.err(error))
			.mockResolvedValueOnce(Result.err(error))
			.mockResolvedValue(Result.ok("recovered"));

		const result = await withRetry(op, {
			maxRetries: 2,
			baseDelayMs: 1,
			isRetryable: (e) => e instanceof TestRetryableError,
		});

		expect(Result.isOk(result) && result.value).toBe("recovered");
		expect(op).toHaveBeenCalledTimes(3);
	});

	it("does not retry non-retryable errors", async () => {
		const error = new TestPermanentError("permanent");
		const op = vi.fn().mockResolvedValue(Result.err(error));

		const result = await withRetry(op, {
			maxRetries: 3,
			baseDelayMs: 1,
			isRetryable: (e) => e instanceof TestRetryableError,
		});

		expect(Result.isError(result)).toBe(true);
		expect(op).toHaveBeenCalledOnce();
	});

	it("returns last error when all retries are exhausted", async () => {
		const error = new TestRetryableError("still failing");
		const op = vi.fn().mockResolvedValue(Result.err(error));

		const result = await withRetry(op, {
			maxRetries: 2,
			baseDelayMs: 1,
		});

		expect(Result.isError(result)).toBe(true);
		expect(op).toHaveBeenCalledTimes(3);
	});

	it("uses getRetryAfterMs to set a floor on delay", async () => {
		const error = new TestRetryableError("rate limited", 50);
		const op = vi
			.fn()
			.mockResolvedValueOnce(Result.err(error))
			.mockResolvedValue(Result.ok("ok"));

		const start = Date.now();
		await withRetry(op, {
			maxRetries: 1,
			baseDelayMs: 1,
			maxDelayMs: 10_000,
			getRetryAfterMs: (e) =>
				e instanceof TestRetryableError ? e.retryAfterMs : undefined,
		});
		const elapsed = Date.now() - start;

		// retryAfterMs=50 should act as floor (baseDelayMs=1 alone would be ~1-2ms)
		expect(elapsed).toBeGreaterThanOrEqual(40);
		expect(op).toHaveBeenCalledTimes(2);
	});

	it("stops retrying when Retry-After exceeds the in-request budget", async () => {
		// A 10s Retry-After against a 100ms budget is a real back-off: surface it to
		// the caller's job-level backoff instead of firing a doomed early retry.
		const error = new TestRetryableError("rate limited", 10_000);
		const op = vi.fn().mockResolvedValue(Result.err(error));

		const result = await withRetry(op, {
			maxRetries: 3,
			baseDelayMs: 1,
			maxDelayMs: 100,
			isRetryable: (e) => e instanceof TestRetryableError,
			getRetryAfterMs: (e) =>
				e instanceof TestRetryableError ? e.retryAfterMs : undefined,
		});

		expect(Result.isError(result)).toBe(true);
		expect(op).toHaveBeenCalledOnce();
	});
});

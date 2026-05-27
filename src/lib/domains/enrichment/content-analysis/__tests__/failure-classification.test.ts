import { describe, expect, it } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import { AnalysisFailedError } from "@/lib/shared/errors/domain/analysis";
import {
	LlmProviderError,
	LlmRateLimitError,
} from "@/lib/shared/errors/external/llm";
import { classifyAnalysisFailure } from "../failure-classification";

describe("classifyAnalysisFailure", () => {
	it("treats LLM rate limits as retryable and carries the Retry-After floor", () => {
		const out = classifyAnalysisFailure(
			new LlmRateLimitError({ provider: "anthropic", retryAfterMs: 8000 }),
		);

		expect(out).toMatchObject({
			isRetryable: true,
			cause: "llm_rate_limit",
			retryAfterMs: 8000,
			provider: "anthropic",
		});
	});

	it("treats LLM 5xx as retryable and keeps provider + status", () => {
		const out = classifyAnalysisFailure(
			new LlmProviderError({
				provider: "openai",
				model: "gpt-4o-mini",
				statusCode: 502,
				message: "bad gateway",
			}),
		);

		expect(out).toMatchObject({
			isRetryable: true,
			cause: "llm_provider",
			provider: "openai",
			statusCode: 502,
		});
	});

	it("treats LLM 4xx as permanent", () => {
		const out = classifyAnalysisFailure(
			new LlmProviderError({
				provider: "google",
				model: "gemini-2.5-flash",
				statusCode: 422,
				message: "unprocessable",
			}),
		);

		expect(out.isRetryable).toBe(false);
		expect(out.cause).toBe("llm_provider");
		expect(out.statusCode).toBe(422);
	});

	it("treats database errors as retryable", () => {
		const out = classifyAnalysisFailure(
			new DatabaseError({ code: "08006", message: "connection lost" }),
		);

		expect(out).toMatchObject({ isRetryable: true, cause: "database" });
	});

	it("treats rejected analyses as permanent", () => {
		const out = classifyAnalysisFailure(
			new AnalysisFailedError({ songId: "s1", reason: "empty output" }),
		);

		expect(out).toMatchObject({
			isRetryable: false,
			cause: "analysis_rejected",
		});
	});

	it("treats unknown errors as permanent and normalizes the message", () => {
		expect(classifyAnalysisFailure(new Error("boom"))).toMatchObject({
			isRetryable: false,
			cause: "unknown",
			message: "boom",
		});
		expect(classifyAnalysisFailure("plain string")).toMatchObject({
			isRetryable: false,
			cause: "unknown",
			message: "plain string",
		});
	});
});

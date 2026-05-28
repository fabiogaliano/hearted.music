/**
 * Single owner of the transient-vs-permanent rules for song analysis. Maps any
 * error (LLM, database, domain) into one structured verdict that the batch
 * analyzer and pipeline stage share instead of re-deriving.
 *
 * Domain-level on purpose: returns a normalized shape (cause + retry metadata),
 * never workflow `FAILURE_CODES`, so the dependency stays domain -> workflow.
 */

import { DatabaseError } from "@/lib/shared/errors/database";
import { AnalysisFailedError } from "@/lib/shared/errors/domain/analysis";
import { errorMessage } from "@/lib/shared/errors/error-message";
import {
	isRetryableLlmError,
	LlmProviderError,
	LlmRateLimitError,
	llmRetryAfterMs,
} from "@/lib/shared/errors/external/llm";

/** Failure origin, for logging and metadata. */
export type AnalysisFailureCause =
	| "llm_rate_limit"
	| "llm_provider"
	| "database"
	| "analysis_rejected"
	| "unknown";

export interface AnalysisFailureClassification {
	/** Whether a future attempt could succeed. */
	isRetryable: boolean;
	/** Failure origin. */
	cause: AnalysisFailureCause;
	/** Provider Retry-After floor in ms, when available. */
	retryAfterMs?: number;
	/** Provider, for external-service failures. */
	provider?: string;
	/** Upstream HTTP status, when present. */
	statusCode?: number;
	/** Human-readable failure summary. */
	message: string;
}

/**
 * Classify a failure into a retry-aware verdict:
 *   - LLM rate limits / 429 / 5xx          -> transient
 *   - LLM 4xx and unknown provider errors  -> permanent
 *   - database errors                      -> transient
 *   - rejected analyses / everything else  -> permanent
 */
export function classifyAnalysisFailure(
	error: unknown,
): AnalysisFailureClassification {
	if (error instanceof LlmRateLimitError) {
		return {
			isRetryable: true,
			cause: "llm_rate_limit",
			retryAfterMs: llmRetryAfterMs(error),
			provider: error.provider,
			message: error.message,
		};
	}

	if (error instanceof LlmProviderError) {
		return {
			isRetryable: isRetryableLlmError(error),
			cause: "llm_provider",
			provider: error.provider,
			statusCode: error.statusCode,
			message: error.message,
		};
	}

	if (error instanceof DatabaseError) {
		return {
			isRetryable: true,
			cause: "database",
			message: error.message,
		};
	}

	if (error instanceof AnalysisFailedError) {
		return {
			isRetryable: false,
			cause: "analysis_rejected",
			message: error.message,
		};
	}

	return {
		isRetryable: false,
		cause: "unknown",
		message: errorMessage(error),
	};
}

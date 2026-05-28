/**
 * HuggingFace Inference API error types (embeddings).
 */

import { TaggedError } from "better-result";

/** HuggingFace API request failed */
export class HuggingFaceApiError extends TaggedError("HuggingFaceApiError")<{
	endpoint: string;
	statusCode?: number;
	message: string;
}>() {
	constructor(endpoint: string, statusCode?: number, detail?: string) {
		super({
			endpoint,
			statusCode,
			message: `HuggingFace ${endpoint} failed${statusCode ? ` (${statusCode})` : ""}${detail ? `: ${detail}` : ""}`,
		});
	}
}

/** HuggingFace rate limit exceeded */
export class HuggingFaceRateLimitError extends TaggedError(
	"HuggingFaceRateLimitError",
)<{
	retryAfterMs?: number;
	message: string;
}>() {
	constructor(retryAfterMs?: number) {
		super({
			retryAfterMs,
			message: `HuggingFace rate limit exceeded${retryAfterMs ? `, retry after ${retryAfterMs}ms` : ""}`,
		});
	}
}

/** All HuggingFace errors */
export type HuggingFaceError = HuggingFaceApiError | HuggingFaceRateLimitError;

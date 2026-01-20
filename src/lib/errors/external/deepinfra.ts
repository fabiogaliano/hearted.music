/**
 * DeepInfra API error types (embeddings, reranking).
 */

import { TaggedError } from "better-result";

/** DeepInfra API request failed */
export class DeepInfraApiError extends TaggedError("DeepInfraApiError")<{
	endpoint: string;
	statusCode?: number;
	message: string;
}>() {
	constructor(endpoint: string, statusCode?: number, detail?: string) {
		super({
			endpoint,
			statusCode,
			message: `DeepInfra ${endpoint} failed${statusCode ? ` (${statusCode})` : ""}${detail ? `: ${detail}` : ""}`,
		});
	}
}

/** DeepInfra rate limit exceeded */
export class DeepInfraRateLimitError extends TaggedError(
	"DeepInfraRateLimitError",
)<{
	retryAfterMs?: number;
	message: string;
}>() {
	constructor(retryAfterMs?: number) {
		super({
			retryAfterMs,
			message: `DeepInfra rate limit exceeded${retryAfterMs ? `, retry after ${retryAfterMs}ms` : ""}`,
		});
	}
}

/** All DeepInfra errors */
export type DeepInfraError = DeepInfraApiError | DeepInfraRateLimitError;

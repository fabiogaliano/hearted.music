/**
 * Embedding operation error types.
 */

import { TaggedError } from "better-result";

/** Embedding dimension mismatch */
export class DimensionMismatchError extends TaggedError(
	"DimensionMismatchError",
)<{
	expected: number;
	actual: number;
	message: string;
}>() {
	constructor(expected: number, actual: number) {
		super({
			expected,
			actual,
			message: `Embedding dimension mismatch: expected ${expected}, got ${actual}`,
		});
	}
}

/** Missing analysis required for embedding */
export class MissingAnalysisError extends TaggedError("MissingAnalysisError")<{
	songId: string;
	message: string;
}>() {
	constructor(songId: string) {
		super({
			songId,
			message: `Song ${songId} requires analysis before embedding`,
		});
	}
}

/** All embedding errors */
export type EmbeddingError = DimensionMismatchError | MissingAnalysisError;

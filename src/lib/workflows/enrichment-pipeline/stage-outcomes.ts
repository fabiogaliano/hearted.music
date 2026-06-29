import { Result, TaggedError } from "better-result";
import { resolveJobStageFailures } from "@/lib/platform/jobs/item-failures";
import type { DbError } from "@/lib/shared/errors/database";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { mapWithConcurrency } from "@/lib/shared/utils/concurrency";
import type { FAILURE_CODES } from "./failure-policy";
import { recordStageFailure } from "./record-failure";
import type { EnrichmentStageName } from "./types";

export type FailureCode = (typeof FAILURE_CODES)[keyof typeof FAILURE_CODES];

export type StageFailure = {
	songId: string;
	failureCode: FailureCode;
	message: string;
	/**
	 * Structured context from the underlying failure so the persistence/policy
	 * layer can act on it (e.g. floor the transient backoff with a Retry-After)
	 * instead of re-parsing the message. Optional: callers that set only
	 * `failureCode` keep working unchanged.
	 */
	retryAfterMs?: number;
	provider?: string;
	statusCode?: number;
	causeTag?: string;
};

export type StageOutcome =
	| {
			kind: "skipped";
			stage: EnrichmentStageName;
			candidateSongIds: string[];
	  }
	| {
			kind: "attempted";
			stage: EnrichmentStageName;
			candidateSongIds: string[];
			attemptedSongIds: string[];
			succeededSongIds: string[];
			failures: StageFailure[];
			/**
			 * Songs handled this pass without a success or failure because work was
			 * deferred to an out-of-band process (audio-feature backfill). Counted as
			 * progress (so a pure-deferred chunk isn't a blocked hot loop) but never
			 * as a success or a failure, and no failure/suppression row is written.
			 * Optional so stages that never defer don't have to set it.
			 */
			deferredSongIds?: string[];
	  };

export type StageSummary = {
	total: number;
	succeeded: number;
	failed: number;
	deferred: number;
};

export type OutcomeValidationError =
	| {
			kind: "overlap";
			songIds: string[];
	  }
	| {
			kind: "attempted_not_in_candidates";
			songIds: string[];
	  }
	| {
			kind: "succeeded_not_in_attempted";
			songIds: string[];
	  }
	| {
			kind: "failed_not_in_attempted";
			songIds: string[];
	  }
	| {
			kind: "duplicate_attempted";
			songIds: string[];
	  }
	| {
			kind: "duplicate_succeeded";
			songIds: string[];
	  }
	| {
			kind: "duplicate_failed";
			songIds: string[];
	  }
	| {
			kind: "duplicate_deferred";
			songIds: string[];
	  }
	| {
			kind: "deferred_not_in_attempted";
			songIds: string[];
	  }
	| {
			kind: "deferred_overlap";
			songIds: string[];
	  };

export class StageAccountingError extends TaggedError("StageAccountingError")<{
	stage: EnrichmentStageName;
	phase:
		| "validate_outcome"
		| "resolve_prior"
		| "record_failures"
		| "compensation";
	cause: DbError | OutcomeValidationError;
	message: string;
}>() {}

function findDuplicateSongIds(songIds: string[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();

	for (const songId of songIds) {
		if (seen.has(songId)) {
			duplicates.add(songId);
			continue;
		}
		seen.add(songId);
	}

	return [...duplicates];
}

function findSongIdsOutsideSet(
	songIds: string[],
	allowedSongIds: Set<string>,
): string[] {
	return [...new Set(songIds.filter((songId) => !allowedSongIds.has(songId)))];
}

export function validateOutcome(
	outcome: StageOutcome,
): OutcomeValidationError | null {
	if (outcome.kind === "skipped") return null;

	const duplicateAttempted = findDuplicateSongIds(outcome.attemptedSongIds);
	if (duplicateAttempted.length > 0) {
		return { kind: "duplicate_attempted", songIds: duplicateAttempted };
	}

	const duplicateSucceeded = findDuplicateSongIds(outcome.succeededSongIds);
	if (duplicateSucceeded.length > 0) {
		return { kind: "duplicate_succeeded", songIds: duplicateSucceeded };
	}

	const failureSongIds = outcome.failures.map((failure) => failure.songId);
	const duplicateFailed = findDuplicateSongIds(failureSongIds);
	if (duplicateFailed.length > 0) {
		return { kind: "duplicate_failed", songIds: duplicateFailed };
	}

	const candidateSet = new Set(outcome.candidateSongIds);
	const attemptedOutsideCandidates = findSongIdsOutsideSet(
		outcome.attemptedSongIds,
		candidateSet,
	);
	if (attemptedOutsideCandidates.length > 0) {
		return {
			kind: "attempted_not_in_candidates",
			songIds: attemptedOutsideCandidates,
		};
	}

	const attemptedSet = new Set(outcome.attemptedSongIds);
	const succeededOutsideAttempted = findSongIdsOutsideSet(
		outcome.succeededSongIds,
		attemptedSet,
	);
	if (succeededOutsideAttempted.length > 0) {
		return {
			kind: "succeeded_not_in_attempted",
			songIds: succeededOutsideAttempted,
		};
	}

	const failedOutsideAttempted = findSongIdsOutsideSet(
		failureSongIds,
		attemptedSet,
	);
	if (failedOutsideAttempted.length > 0) {
		return {
			kind: "failed_not_in_attempted",
			songIds: failedOutsideAttempted,
		};
	}

	const succeededSet = new Set(outcome.succeededSongIds);
	const overlapping = outcome.failures
		.filter((failure) => succeededSet.has(failure.songId))
		.map((failure) => failure.songId);
	if (overlapping.length > 0) {
		return { kind: "overlap", songIds: [...new Set(overlapping)] };
	}

	const deferred = outcome.deferredSongIds ?? [];
	const duplicateDeferred = findDuplicateSongIds(deferred);
	if (duplicateDeferred.length > 0) {
		return { kind: "duplicate_deferred", songIds: duplicateDeferred };
	}

	const deferredOutsideAttempted = findSongIdsOutsideSet(
		deferred,
		attemptedSet,
	);
	if (deferredOutsideAttempted.length > 0) {
		return {
			kind: "deferred_not_in_attempted",
			songIds: deferredOutsideAttempted,
		};
	}

	const deferredSet = new Set(deferred);
	const deferredOverlap = [
		...outcome.succeededSongIds.filter((id) => deferredSet.has(id)),
		...failureSongIds.filter((id) => deferredSet.has(id)),
	];
	if (deferredOverlap.length > 0) {
		return { kind: "deferred_overlap", songIds: [...new Set(deferredOverlap)] };
	}

	return null;
}

export function summarizeOutcome(outcome: StageOutcome): StageSummary {
	if (outcome.kind === "skipped") {
		return { total: 0, succeeded: 0, failed: 0, deferred: 0 };
	}
	return {
		total: outcome.attemptedSongIds.length,
		succeeded: outcome.succeededSongIds.length,
		failed: outcome.failures.length,
		deferred: (outcome.deferredSongIds ?? []).length,
	};
}

export function makeSkippedOutcome(
	stage: EnrichmentStageName,
	candidateSongIds: string[],
): StageOutcome {
	return { kind: "skipped", stage, candidateSongIds };
}

export function makeThrownOutcome(
	stage: EnrichmentStageName,
	candidateSongIds: string[],
	error: unknown,
	fallbackCode: FailureCode,
): StageOutcome {
	const message = errorMessage(error);
	return {
		kind: "attempted",
		stage,
		candidateSongIds,
		attemptedSongIds: candidateSongIds,
		succeededSongIds: [],
		failures: candidateSongIds.map((songId) => ({
			songId,
			failureCode: fallbackCode,
			message,
		})),
	};
}

interface FinalizeParams {
	outcome: StageOutcome;
	jobId: string;
	accountId: string;
}

// Caps the per-song resolve/record fan-out: a 50-song batch otherwise dispatches
// 50 DB round-trips in one tick (each backoff-coded failure also does a prior-
// count read first), spiking pool usage. 12 keeps the pool healthy with no real
// latency cost at batch sizes this small.
const FINALIZE_CONCURRENCY = 12;

export async function finalizeStageOutcome(
	params: FinalizeParams,
): Promise<Result<StageSummary, StageAccountingError>> {
	const { outcome, jobId, accountId } = params;

	if (outcome.kind === "skipped") {
		return Result.ok(summarizeOutcome(outcome));
	}

	const validationError = validateOutcome(outcome);
	if (validationError) {
		return Result.err(
			new StageAccountingError({
				stage: outcome.stage,
				phase: "validate_outcome",
				cause: validationError,
				message: `Outcome validation failed for stage ${outcome.stage}: ${validationError.kind} (${validationError.songIds.join(", ")})`,
			}),
		);
	}

	if (outcome.succeededSongIds.length > 0) {
		const resolveResults = await mapWithConcurrency(
			outcome.succeededSongIds,
			FINALIZE_CONCURRENCY,
			(songId) =>
				resolveJobStageFailures({
					accountId,
					itemId: songId,
					stage: outcome.stage,
				}),
		);

		const firstError = resolveResults.find(Result.isError);
		if (firstError && Result.isError(firstError)) {
			return Result.err(
				new StageAccountingError({
					stage: outcome.stage,
					phase: "resolve_prior",
					cause: firstError.error,
					message: `Failed to resolve prior failures for stage ${outcome.stage}`,
				}),
			);
		}
	}

	if (outcome.failures.length > 0) {
		const recordResults = await mapWithConcurrency(
			outcome.failures,
			FINALIZE_CONCURRENCY,
			(f) =>
				recordStageFailure({
					jobId,
					accountId,
					songId: f.songId,
					stage: outcome.stage,
					failureCode: f.failureCode,
					errorMessage: f.message,
					retryAfterMs: f.retryAfterMs,
				}),
		);

		const firstError = recordResults.find(Result.isError);
		if (firstError && Result.isError(firstError)) {
			return Result.err(
				new StageAccountingError({
					stage: outcome.stage,
					phase: "record_failures",
					cause: firstError.error,
					message: `Failed to record failure rows for stage ${outcome.stage}`,
				}),
			);
		}
	}

	return Result.ok(summarizeOutcome(outcome));
}

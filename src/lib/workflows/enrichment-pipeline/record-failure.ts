/**
 * Stage-handler-facing wrapper for recording a failure with the right
 * lifecycle metadata. Owns the small piece of glue between the pure
 * failure-policy module and the data layer:
 *   - looks up prior unresolved-row count (only for backoff-driven codes)
 *   - applies the policy
 *   - writes the row
 *
 * Stage code should call this instead of recordJobItemFailure directly so the
 * suppression behavior stays centralized.
 */

import { Result } from "better-result";
import {
	countUnresolvedJobStageFailures,
	recordJobItemFailure,
} from "@/lib/platform/jobs/item-failures";
import type { DbError } from "@/lib/shared/errors/database";
import { applyFailurePolicy, BACKOFF_CODES } from "./failure-policy";

interface RecordStageFailureParams {
	jobId: string;
	accountId: string;
	songId: string;
	stage: string;
	failureCode: string;
	errorMessage?: string;
	/** Provider Retry-After floor in ms, forwarded to the transient backoff. */
	retryAfterMs?: number;
	now?: Date;
}

export async function recordStageFailure(
	params: RecordStageFailureParams,
): Promise<Result<void, DbError>> {
	let priorUnresolvedCount: number | undefined;

	// Only backoff-driven codes need the prior-count lookup. The set is owned
	// by the policy module so additions stay in lockstep.
	if (BACKOFF_CODES.has(params.failureCode)) {
		const countResult = await countUnresolvedJobStageFailures({
			accountId: params.accountId,
			itemId: params.songId,
			stage: params.stage,
			failureCode: params.failureCode,
		});
		priorUnresolvedCount = Result.isOk(countResult) ? countResult.value : 0;
	}

	const policy = applyFailurePolicy({
		failureCode: params.failureCode,
		priorUnresolvedCount,
		retryAfterMs: params.retryAfterMs,
		now: params.now,
	});

	return recordJobItemFailure({
		jobId: params.jobId,
		itemId: params.songId,
		stage: params.stage,
		failureCode: params.failureCode,
		isTerminal: policy.isTerminal,
		suppressUntil: policy.suppressUntil,
		errorMessage: params.errorMessage,
	});
}

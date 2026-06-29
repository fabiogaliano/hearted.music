/**
 * Stage-handler-facing wrapper for recording a failure with the right
 * lifecycle metadata. Owns the small piece of glue between the pure
 * failure-policy module and the data layer:
 *   - looks up prior unresolved-row count (only for backoff-driven codes)
 *   - applies the policy
 *   - writes the row
 *   - for escalated blocked codes, rewrites to analysis_inputs_missing and
 *     fires replacement-credit compensation (§7.2)
 *
 * Stage code should call this instead of recordJobItemFailure directly so the
 * suppression behavior stays centralized.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { grantAnalysisFailureReplacementCredit } from "@/lib/domains/billing/compensation";
import {
	countUnresolvedJobStageFailures,
	recordJobItemFailure,
} from "@/lib/platform/jobs/item-failures";
import type { DbError } from "@/lib/shared/errors/database";
import {
	applyFailurePolicy,
	BACKOFF_CODES,
	FAILURE_CODES,
} from "./failure-policy";

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
		// The prior count drives both the backoff window and the escalation-to-
		// terminal ladder for blocked codes. Silently defaulting to 0 on a query
		// failure would wrong both — most harmfully, a blocked song could never reach
		// BLOCKED_ESCALATION_THRESHOLD and would loop in short-retry purgatory
		// forever. Surface the error so the chunk records a StageAccountingError and
		// retries with a real count instead of persisting a bad policy decision.
		if (Result.isError(countResult)) {
			return Result.err(countResult.error);
		}
		priorUnresolvedCount = countResult.value;
	}

	const policy = applyFailurePolicy({
		failureCode: params.failureCode,
		priorUnresolvedCount,
		retryAfterMs: params.retryAfterMs,
		now: params.now,
	});

	// Blocked codes that hit the escalation threshold are recorded as
	// analysis_inputs_missing so the DB row carries terminal semantics and the
	// compensation RPC (gated on that exact code server-side) fires correctly.
	const effectiveCode = policy.escalatedToInputsMissing
		? FAILURE_CODES.ANALYSIS_INPUTS_MISSING
		: params.failureCode;

	const recordResult = await recordJobItemFailure({
		jobId: params.jobId,
		itemId: params.songId,
		stage: params.stage,
		failureCode: effectiveCode,
		isTerminal: policy.isTerminal,
		suppressUntil: policy.suppressUntil,
		errorMessage: params.errorMessage,
	});

	if (Result.isError(recordResult)) {
		return recordResult;
	}

	// Idempotent replacement-credit compensation fires after the failure row is
	// durably written so we never grant credit without a corresponding row (§7.2).
	if (policy.escalatedToInputsMissing) {
		const supabase = createAdminSupabaseClient();
		const compensationResult = await grantAnalysisFailureReplacementCredit(
			supabase,
			{
				accountId: params.accountId,
				songId: params.songId,
				failureCode: FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
			},
		);
		if (Result.isError(compensationResult)) {
			return compensationResult;
		}
	}

	return Result.ok(undefined);
}

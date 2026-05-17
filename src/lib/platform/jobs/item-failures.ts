/**
 * Per-item job failure tracking with lifecycle metadata.
 *
 * Lifecycle columns (added by 20260426180000_job_failure_lifecycle):
 *   - is_terminal:    permanent block when true.
 *   - suppress_until: temporary block window for non-terminal failures.
 *   - resolved_at:    set on stage success to retire historical rows.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { fromSupabaseSingle } from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "@/lib/data/client";

interface RecordJobFailureParams {
	jobId: string;
	itemId: string;
	stage: string | null;
	failureCode: string;
	isTerminal: boolean;
	errorMessage?: string;
	suppressUntil?: Date | null;
	resolvedAt?: Date | null;
}

export function recordJobItemFailure(
	params: RecordJobFailureParams,
): Promise<Result<void, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("job_failure")
			.insert({
				job_id: params.jobId,
				item_type: "song",
				item_id: params.itemId,
				stage: params.stage,
				failure_code: params.failureCode,
				is_terminal: params.isTerminal,
				error_message: params.errorMessage ?? null,
				suppress_until: params.suppressUntil
					? params.suppressUntil.toISOString()
					: null,
				resolved_at: params.resolvedAt ? params.resolvedAt.toISOString() : null,
			})
			.select()
			.single(),
	).then((result) => (Result.isOk(result) ? Result.ok(undefined) : result));
}

/**
 * Mark all unresolved non-terminal failure rows for a song's stage as
 * resolved. Called from stage-success paths so prior suppression rows stop
 * blocking future selector passes.
 */
export async function resolveJobStageFailures(params: {
	accountId: string;
	itemId: string;
	stage: string;
}): Promise<Result<number, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc("resolve_stage_failures", {
		p_account_id: params.accountId,
		p_item_id: params.itemId,
		p_stage: params.stage,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(typeof data === "number" ? data : 0);
}

/**
 * Count unresolved non-terminal failures for a song's stage + code. Used by
 * the failure-policy module to escalate transient backoff windows.
 */
export async function countUnresolvedJobStageFailures(params: {
	accountId: string;
	itemId: string;
	stage: string;
	failureCode: string;
}): Promise<Result<number, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc("count_unresolved_failures", {
		p_account_id: params.accountId,
		p_item_id: params.itemId,
		p_stage: params.stage,
		p_failure_code: params.failureCode,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(typeof data === "number" ? data : 0);
}

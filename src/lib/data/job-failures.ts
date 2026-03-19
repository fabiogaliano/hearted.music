/**
 * Terminal failure tracking for per-song enrichment failures.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";

const TERMINAL_ERROR_TYPES = ["validation", "unsupported", "auth", "permanent"];

export function recordTerminalFailure(params: {
	jobId: string;
	itemId: string;
	errorType: string;
	errorMessage?: string;
}): Promise<Result<void, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("job_failure")
			.insert({
				job_id: params.jobId,
				item_type: "song",
				item_id: params.itemId,
				error_type: params.errorType,
				error_message: params.errorMessage ?? null,
			})
			.select()
			.single(),
	).then((result) => (Result.isOk(result) ? Result.ok(undefined) : result));
}

export async function getTerminallyFailedSongIds(
	accountId: string,
): Promise<Result<string[], DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany(
		supabase
			.from("job_failure")
			.select("item_id, job!inner(account_id)")
			.eq("item_type", "song")
			.in("error_type", TERMINAL_ERROR_TYPES)
			.eq("job.account_id", accountId),
	);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	const uniqueIds = [
		...new Set(result.value.map((row: { item_id: string }) => row.item_id)),
	];
	return Result.ok(uniqueIds);
}

export async function clearTerminalFailure(
	itemId: string,
): Promise<Result<void, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { error } = await supabase
		.from("job_failure")
		.delete()
		.eq("item_id", itemId)
		.in("error_type", TERMINAL_ERROR_TYPES);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(undefined);
}

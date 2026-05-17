import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { JobProgress } from "@/lib/platform/jobs/progress/types";
import {
	getActiveJob,
	type Job,
	type JobType,
} from "@/lib/platform/jobs/repository";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { fromSupabaseSingle } from "@/lib/shared/utils/result-wrappers/supabase";

export async function ensureWalkthroughPreviewJob(
	accountId: string,
): Promise<Result<Job, DbError>> {
	let lastError: Result<Job, DbError> | undefined;

	for (let attempt = 0; attempt < 2; attempt++) {
		const existing = await getActiveJob(accountId, "walkthrough_match_preview");
		if (Result.isError(existing)) return existing;
		if (existing.value) return Result.ok(existing.value);

		const supabase = createAdminSupabaseClient();
		const initialProgress: JobProgress = {
			total: 1,
			done: 0,
			succeeded: 0,
			failed: 0,
		};

		const created = await fromSupabaseSingle(
			supabase
				.from("job")
				.insert({
					account_id: accountId,
					type: "walkthrough_match_preview" as JobType,
					status: "pending" as const,
					progress: initialProgress,
				})
				.select()
				.single(),
		);

		if (Result.isOk(created)) return created;
		if (created.error._tag !== "ConstraintError") return created;
		lastError = created;
	}

	return (
		lastError ??
		Result.err(
			new DatabaseError({
				code: "walkthrough_preview_job_ensure_failed",
				message:
					"Failed to ensure walkthrough preview job after retrying constraint races",
			}),
		)
	);
}

export async function claimWalkthroughPreviewJob(): Promise<
	Result<Job | null, DbError>
> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"claim_pending_walkthrough_preview_job",
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	if (!data || (Array.isArray(data) && data.length === 0)) {
		return Result.ok(null);
	}

	const job = Array.isArray(data) ? data[0] : data;
	return Result.ok(job as Job);
}

export async function sweepStaleWalkthroughPreviewJobs(
	staleThreshold: string,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"sweep_stale_walkthrough_preview_jobs",
		{ stale_threshold: staleThreshold },
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok((data ?? []) as Job[]);
}

export async function markDeadWalkthroughPreviewJobs(
	staleThreshold: string,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"mark_dead_walkthrough_preview_jobs",
		{ stale_threshold: staleThreshold },
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok((data ?? []) as Job[]);
}

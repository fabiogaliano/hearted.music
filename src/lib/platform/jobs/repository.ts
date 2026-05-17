import { Result } from "better-result";
import type { EnrichmentChunkProgress } from "@/lib/platform/jobs/progress/enrichment";
import {
	JobProgressSchema as JobProgressSchemaImpl,
	type JobProgress as JobProgressType,
} from "@/lib/platform/jobs/progress/types";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Enums, Tables } from "@/lib/data/database.types";

export type Job = Tables<"job">;
export type JobType = Enums<"job_type">;
export type JobStatus = Enums<"job_status">;
export type JobProgress = JobProgressType;
export const JobProgressSchema = JobProgressSchemaImpl;

export function getJobById(id: string): Promise<Result<Job | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase.from("job").select("*").eq("id", id).single(),
	);
}

export function getActiveJob(
	accountId: string,
	type: JobType,
): Promise<Result<Job | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("job")
			.select("*")
			.eq("account_id", accountId)
			.eq("type", type)
			.in("status", ["pending", "running"])
			.order("created_at", { ascending: false })
			.limit(1)
			.single(),
	);
}

export function getLatestJob(
	accountId: string,
	type: JobType,
): Promise<Result<Job | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("job")
			.select("*")
			.eq("account_id", accountId)
			.eq("type", type)
			.order("created_at", { ascending: false })
			.limit(1)
			.single(),
	);
}

export function getJobs(accountId: string): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("job")
			.select("*")
			.eq("account_id", accountId)
			.order("created_at", { ascending: false }),
	);
}

export function createJob(
	accountId: string,
	type: JobType,
): Promise<Result<Job, DbError>> {
	const supabase = createAdminSupabaseClient();
	const initialProgress: JobProgress = {
		total: 0,
		done: 0,
		succeeded: 0,
		failed: 0,
	};

	return fromSupabaseSingle(
		supabase
			.from("job")
			.insert({
				account_id: accountId,
				type,
				status: "pending",
				progress: initialProgress,
			})
			.select()
			.single(),
	);
}

export function updateJobProgress(
	id: string,
	progress:
		| JobProgress
		| EnrichmentChunkProgress
		| import("@/lib/platform/jobs/progress/match-snapshot-refresh").MatchSnapshotRefreshProgress,
): Promise<Result<Job, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase.from("job").update({ progress }).eq("id", id).select().single(),
	);
}

export function markJobRunning(id: string): Promise<Result<Job, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("job")
			.update({
				status: "running",
				started_at: new Date().toISOString(),
			})
			.eq("id", id)
			.select()
			.single(),
	);
}

export function markJobCompleted(id: string): Promise<Result<Job, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("job")
			.update({
				status: "completed",
				completed_at: new Date().toISOString(),
			})
			.eq("id", id)
			.select()
			.single(),
	);
}

export function markJobFailed(
	id: string,
	error?: string,
): Promise<Result<Job, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("job")
			.update({
				status: "failed",
				error: error ?? null,
				completed_at: new Date().toISOString(),
			})
			.eq("id", id)
			.select()
			.single(),
	);
}

export async function updateHeartbeat(
	jobId: string,
): Promise<Result<void, DbError>> {
	const supabase = createAdminSupabaseClient();

	const { error } = await supabase
		.from("job")
		.update({ heartbeat_at: new Date().toISOString() })
		.eq("id", jobId);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(undefined);
}

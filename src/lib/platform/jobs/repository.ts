import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Enums, Json, Tables } from "@/lib/data/database.types";
import type { EnrichmentChunkProgress } from "@/lib/platform/jobs/progress/enrichment";
import {
	JobProgressSchema as JobProgressSchemaImpl,
	type JobProgress as JobProgressType,
} from "@/lib/platform/jobs/progress/types";
import type { DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";

export type Job = Tables<"job">;
export type JobType = Enums<"job_type">;
export type JobStatus = Enums<"job_status">;
export type JobProgress = JobProgressType;
export const JobProgressSchema = JobProgressSchemaImpl;

/**
 * Gets a job by ID. Pass `accountId` from user-facing call sites to scope the
 * read to the owning account (the service-role client bypasses RLS). Internal
 * worker sweeps that legitimately operate across accounts may omit it.
 */
export function getJobById(
	id: string,
	accountId?: string,
): Promise<Result<Job | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	let query = supabase.from("job").select("*").eq("id", id);
	if (accountId !== undefined) {
		query = query.eq("account_id", accountId);
	}
	return fromSupabaseMaybe(query.single());
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

/**
 * Outcome of a compare-and-set status write. "superseded" means the row was no
 * longer in the transition's expected prior state — another writer (a sweep,
 * a reclaiming worker, a self-heal) already moved it — so the caller must not
 * act on the transition it attempted.
 */
export type JobTransition = "applied" | "superseded";

async function transition(
	query: PromiseLike<{
		data: { id: string }[] | null;
		error: { code: string; message: string } | null;
	}>,
): Promise<Result<JobTransition, DbError>> {
	const rows = await fromSupabaseMany(query);
	return Result.map(rows, (r) => (r.length > 0 ? "applied" : "superseded"));
}

export function markJobRunning(
	id: string,
): Promise<Result<JobTransition, DbError>> {
	const supabase = createAdminSupabaseClient();
	return transition(
		supabase
			.from("job")
			.update({
				status: "running",
				started_at: new Date().toISOString(),
			})
			.eq("id", id)
			.eq("status", "pending")
			.select("id"),
	);
}

// Terminal writes accept pending too: failure paths fail phases that never
// started. `progress` lands in the same write so a completed row can never be
// observed without the result it was completed with.
export function markJobCompleted(
	id: string,
	progress?: Json,
): Promise<Result<JobTransition, DbError>> {
	const supabase = createAdminSupabaseClient();
	return transition(
		supabase
			.from("job")
			.update({
				status: "completed",
				completed_at: new Date().toISOString(),
				...(progress === undefined ? {} : { progress }),
			})
			.eq("id", id)
			.in("status", ["pending", "running"])
			.select("id"),
	);
}

export function markJobFailed(
	id: string,
	error?: string,
): Promise<Result<JobTransition, DbError>> {
	const supabase = createAdminSupabaseClient();
	return transition(
		supabase
			.from("job")
			.update({
				status: "failed",
				error: error ?? null,
				completed_at: new Date().toISOString(),
			})
			.eq("id", id)
			.in("status", ["pending", "running"])
			.select("id"),
	);
}

/**
 * Terminal write for a job leased by a claim RPC. Each claim increments
 * `attempts`, so fencing on it rejects a worker whose claim was swept back to
 * pending and re-claimed (or dead-lettered) while it was still running.
 */
export function markClaimedJobTerminal(
	job: Pick<Job, "id" | "attempts">,
	status: "completed" | "failed",
	error?: string,
): Promise<Result<JobTransition, DbError>> {
	const supabase = createAdminSupabaseClient();
	return transition(
		supabase
			.from("job")
			.update({
				status,
				error: error ?? null,
				completed_at: new Date().toISOString(),
			})
			.eq("id", job.id)
			.eq("status", "running")
			.eq("attempts", job.attempts)
			.select("id"),
	);
}

/**
 * Renews a claimed job's lease, fenced like markClaimedJobTerminal: a stale
 * worker that keeps renewing a reclaimed row would hide the new owner's death
 * from the stale sweep.
 */
export function updateHeartbeat(
	job: Pick<Job, "id" | "attempts">,
): Promise<Result<JobTransition, DbError>> {
	const supabase = createAdminSupabaseClient();
	return transition(
		supabase
			.from("job")
			.update({ heartbeat_at: new Date().toISOString() })
			.eq("id", job.id)
			.eq("status", "running")
			.eq("attempts", job.attempts)
			.select("id"),
	);
}

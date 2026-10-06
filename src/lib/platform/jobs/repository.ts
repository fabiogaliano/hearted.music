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
			.maybeSingle(),
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
			.maybeSingle(),
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

/**
 * Progress write for a claimed job, fenced like updateHeartbeat: a stale
 * worker's write landing just before it notices lease loss would otherwise
 * overwrite the new owner's progress.
 */
export function updateJobProgress(
	job: Pick<Job, "id" | "attempts">,
	progress:
		| JobProgress
		| EnrichmentChunkProgress
		| import("@/lib/platform/jobs/progress/match-snapshot-refresh").MatchSnapshotRefreshProgress,
): Promise<Result<JobTransition, DbError>> {
	const supabase = createAdminSupabaseClient();
	return transition(
		supabase
			.from("job")
			.update({ progress })
			.eq("id", job.id)
			.eq("status", "running")
			.eq("attempts", job.attempts)
			.select("id"),
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

/**
 * Sync phase jobs are leased through their parent extension_sync claim: a
 * phase's `attempts` holds the parent attempt that started it. That lets a
 * reclaimed parent tell a phase stranded by its own crashed predecessor from
 * one a live run owns, and fences the predecessor's late settle out after a
 * takeover. Phases started before this lease existed hold 0, so any retry
 * can take them over.
 */
export function markJobRunning(
	phase: Pick<Job, "id" | "attempts">,
): Promise<Result<JobTransition, DbError>> {
	const supabase = createAdminSupabaseClient();
	return transition(
		supabase
			.from("job")
			.update({
				status: "running",
				started_at: new Date().toISOString(),
				attempts: phase.attempts,
			})
			.eq("id", phase.id)
			.eq("status", "pending")
			.select("id"),
	);
}

// Strictly-older lease only: two retries racing for the same stranded phase
// serialize on the row, and the newer parent attempt always wins.
export function takeOverRunningJob(
	phase: Pick<Job, "id" | "attempts">,
): Promise<Result<JobTransition, DbError>> {
	const supabase = createAdminSupabaseClient();
	return transition(
		supabase
			.from("job")
			.update({
				started_at: new Date().toISOString(),
				attempts: phase.attempts,
			})
			.eq("id", phase.id)
			.eq("status", "running")
			.lt("attempts", phase.attempts)
			.select("id"),
	);
}

// `progress` lands in the same write so a completed row can never be observed
// without the result it was completed with. Fenced on the phase lease (see
// markJobRunning) so a run whose phase was taken over cannot clobber it.
export function markJobCompleted(
	phase: Pick<Job, "id" | "attempts">,
	progress: Json,
): Promise<Result<JobTransition, DbError>> {
	const supabase = createAdminSupabaseClient();
	return transition(
		supabase
			.from("job")
			.update({
				status: "completed",
				completed_at: new Date().toISOString(),
				progress,
			})
			.eq("id", phase.id)
			.eq("status", "running")
			.eq("attempts", phase.attempts)
			.select("id"),
	);
}

// Accepts pending too: failure paths fail phases that never started.
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

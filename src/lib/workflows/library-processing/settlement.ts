import { Result } from "better-result";
import postgres from "postgres";
import { env } from "@/env";
import { writeAccountEvent } from "@/lib/account-events/producer";
import type { Job, JobTransition } from "@/lib/platform/jobs/repository";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import { errorMessage } from "@/lib/shared/errors/error-message";
import {
	accountEventsOf,
	finalErrorOf,
	finalStatusOf,
	type WorkerOutcome,
} from "./worker-outcome";

// Worker-only SQL instance for transactional job finalizes
const sql = postgres(env.DATABASE_URL, {
	max: 1,
	prepare: false,
	fetch_types: false,
});

// Linear backoff keeps retried jobs from hammering a provider that just
// failed, while staying well under the stale-sweep threshold.
const RETRY_BACKOFF_BASE_SECONDS = 30;

/**
 * Requeue a running job whose execution threw, consuming one attempt (the
 * claim RPC already incremented `attempts`). Mirrors the stale-job sweep's
 * reset (status back to pending, started_at/heartbeat_at cleared) so app-level
 * errors get the same retry budget as worker crashes. Returns false when this
 * claim no longer owns the job (swept, reclaimed, or dead-lettered); the
 * caller's terminal settle is then superseded too.
 */
export async function requeueLibraryProcessingJobForRetry(
	job: Job,
	errorMsg: string,
): Promise<Result<boolean, DbError>> {
	try {
		const rows = await sql`
			UPDATE job
			SET status = 'pending',
			    started_at = NULL,
			    heartbeat_at = NULL,
			    error = ${errorMsg},
			    available_at = now() + make_interval(secs => ${RETRY_BACKOFF_BASE_SECONDS * job.attempts}),
			    updated_at = now()
			WHERE id = ${job.id} AND status = 'running' AND attempts = ${job.attempts}
			RETURNING id
		`;
		return Result.ok(rows.length > 0);
	} catch (error) {
		const message = errorMessage(error);
		return Result.err(new DatabaseError({ code: "requeue_failed", message }));
	}
}

/**
 * Terminal write fenced to the claim that produced `job`: the claim RPC bumps
 * `attempts`, so a sweep + reclaim (or a dead-letter) makes a late worker's
 * snapshot stale. Losing the fence means another claim owns the outcome, so
 * the caller must write no state and emit no events.
 */
async function fenceTerminal(
	tx: postgres.TransactionSql<Record<string, never>>,
	job: Job,
	status: "completed" | "failed",
	errorMsg: string | null,
): Promise<boolean> {
	const rows = await tx`
		UPDATE job
		SET status = ${status},
		    completed_at = now(),
		    error = ${errorMsg}
		WHERE id = ${job.id} AND status = 'running' AND attempts = ${job.attempts}
		RETURNING id
	`;
	return rows.length > 0;
}

/**
 * Ends this claim's job with `outcome`: the fenced terminal status and the
 * outcome's account events commit together, so no event is ever emitted for
 * a run another claim owns.
 */
export async function finalizeLibraryProcessingJob(
	job: Job,
	outcome: WorkerOutcome,
): Promise<Result<JobTransition, DbError>> {
	try {
		const transition = await sql.begin(async (tx) => {
			if (
				!(await fenceTerminal(
					tx,
					job,
					finalStatusOf(outcome),
					finalErrorOf(outcome),
				))
			) {
				return "superseded" as const;
			}

			if (outcome.workflow === "match_snapshot_refresh") {
				await tx`
					INSERT INTO library_processing_state (account_id)
					VALUES (${job.account_id})
					ON CONFLICT (account_id) DO NOTHING
				`;

				if (outcome.status === "published") {
					const marker = job.satisfies_requested_at;
					await tx`
						UPDATE library_processing_state
						SET match_snapshot_refresh_settled_at = CASE
								WHEN match_snapshot_refresh_settled_at IS NOT NULL
									AND match_snapshot_refresh_settled_at > COALESCE(${marker}::timestamptz, match_snapshot_refresh_requested_at, now())
								THEN match_snapshot_refresh_settled_at
								ELSE COALESCE(${marker}::timestamptz, match_snapshot_refresh_requested_at, now())
							END,
							match_snapshot_refresh_active_job_id = CASE
								WHEN match_snapshot_refresh_active_job_id = ${job.id} THEN NULL
								ELSE match_snapshot_refresh_active_job_id
							END
						WHERE account_id = ${job.account_id}
					`;
				} else {
					await tx`
						UPDATE library_processing_state
						SET match_snapshot_refresh_active_job_id = CASE
							WHEN match_snapshot_refresh_active_job_id = ${job.id} THEN NULL
							ELSE match_snapshot_refresh_active_job_id
						END
						WHERE account_id = ${job.account_id}
					`;
				}
			}

			for (const event of accountEventsOf(outcome)) {
				await writeAccountEvent(tx, event);
			}
			return "applied" as const;
		});
		return Result.ok(transition);
	} catch (error) {
		const message = errorMessage(error);
		return Result.err(new DatabaseError({ code: "finalize_failed", message }));
	}
}

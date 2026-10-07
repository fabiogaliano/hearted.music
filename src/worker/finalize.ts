import { Result } from "better-result";
import postgres from "postgres";
import { env } from "@/env";
import { writeAccountEvent } from "@/lib/account-events/producer";
import type { Job } from "@/lib/platform/jobs/repository";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { withRetry } from "@/lib/shared/utils/result-wrappers/generic";
import {
	accountEventsOf,
	finalErrorOf,
	finalStatusOf,
	measurementOf,
	type WorkerOutcome,
} from "@/lib/workflows/library-processing/worker-outcome";

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

export type FinalizeTransition = "applied" | "lease_lost";

/**
 * Ends this claim's job with `outcome` in one transaction: the fenced terminal
 * status, the execution measurement and the account events commit together,
 * so a run is either fully recorded or not at all, and nothing is recorded for
 * a run another claim owns ("lease_lost"). It writes no
 * library_processing_state: freshness moves only through the change the
 * caller applies next, or through terminal recovery replaying that change
 * from this measurement while the workflow's active ref still names the job.
 *
 * A completed run's work is already done, so its finalize is retried through
 * transient errors. A failed run gets one attempt; if it misses, the stale
 * sweep ends the job instead.
 */
export async function finalizeJob(
	job: Job,
	outcome: WorkerOutcome,
): Promise<Result<FinalizeTransition, DbError>> {
	const status = finalStatusOf(outcome);
	const error = finalErrorOf(outcome);

	let anAttemptErrored = false;
	const result = await withRetry(
		async () => {
			const attempt = await finalizeOnce(job, outcome);
			if (Result.isError(attempt)) anAttemptErrored = true;
			return attempt;
		},
		{
			maxRetries: status === "completed" ? 3 : 0,
			baseDelayMs: 200,
			isRetryable: (e) => e instanceof DatabaseError,
		},
	);
	if (
		!anAttemptErrored ||
		(Result.isOk(result) && result.value === "applied")
	) {
		return result;
	}

	// An errored attempt can still have committed with only its reply lost;
	// the next attempt then loses the fence to this claim's own write. The row
	// tells them apart: only this claim's finalize leaves its attempts with this
	// status and error text (a dead-letter writes its own error).
	try {
		const [row] = await sql<
			{ status: string; attempts: number; error: string | null }[]
		>`SELECT status, attempts, error FROM job WHERE id = ${job.id}`;
		const committed =
			row !== undefined &&
			row.status === status &&
			row.attempts === job.attempts &&
			row.error === error;
		return committed ? Result.ok("applied") : result;
	} catch (readError) {
		return Result.err(
			new DatabaseError({
				code: "finalize_failed",
				message: errorMessage(readError),
			}),
		);
	}
}

async function finalizeOnce(
	job: Job,
	outcome: WorkerOutcome,
): Promise<Result<FinalizeTransition, DbError>> {
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
				return "lease_lost" as const;
			}

			const measurement = measurementOf(outcome);
			await tx`
				INSERT INTO job_execution_measurement (
					job_id, account_id, workflow, queue_priority, attempt_number,
					queued_at, started_at, finished_at, outcome, details
				) VALUES (
					${measurement.job_id}, ${measurement.account_id}, ${measurement.workflow},
					${job.queue_priority}, ${job.attempts}, ${job.created_at},
					${job.started_at}, now(), ${measurement.outcome},
					${tx.json(measurement.details)}
				)
			`;

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

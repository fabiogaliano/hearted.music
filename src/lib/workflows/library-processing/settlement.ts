import { Result } from "better-result";
import postgres from "postgres";
import { env } from "@/env";
import { writeAccountEvent } from "@/lib/account-events/producer";
import { parseJobProgress } from "@/lib/platform/jobs/progress/parse";
import type { Job } from "@/lib/platform/jobs/repository";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import { errorMessage } from "@/lib/shared/errors/error-message";

// Worker-only SQL instance for transactional job settlements
const sql = postgres(env.DATABASE_URL, {
	max: 1,
	prepare: false,
	fetch_types: false,
});

export async function settleMatchSnapshotRefreshJobTerminal(
	job: Job,
	status: "completed" | "failed",
	reason: "published" | "superseded" | "failed",
	snapshotId: string | null,
	errorMsg?: string,
): Promise<Result<void, DbError>> {
	try {
		await sql.begin(async (tx) => {
			await tx`
				UPDATE job 
				SET status = ${status}, 
				    completed_at = now(), 
				    error = ${errorMsg ?? null}
				WHERE id = ${job.id}
			`;

			await tx`
				INSERT INTO library_processing_state (account_id)
				VALUES (${job.account_id})
				ON CONFLICT (account_id) DO NOTHING
			`;

			if (reason === "published") {
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

			if (reason === "published" && snapshotId) {
				await writeAccountEvent(tx, {
					accountId: job.account_id,
					type: "match_snapshot_published",
					payload: { orientation: "song", snapshotId },
				});
				await writeAccountEvent(tx, {
					accountId: job.account_id,
					type: "match_snapshot_published",
					payload: { orientation: "playlist", snapshotId },
				});
			} else if (reason === "failed") {
				await writeAccountEvent(tx, {
					accountId: job.account_id,
					type: "match_snapshot_failed",
					payload: {
						orientation: null,
						snapshotId: snapshotId,
						reason: errorMsg ?? "unknown_error",
					},
				});
			}
		});
		return Result.ok(undefined);
	} catch (error) {
		const message = errorMessage(error);
		return Result.err(
			new DatabaseError({ code: "settlement_failed", message }),
		);
	}
}

export async function settleEnrichmentJobTerminal(
	job: Job,
	status: "completed" | "failed",
	eventReason: "completed" | "user_cancelled" | "failed" | "superseded",
	errorMsg?: string,
): Promise<Result<void, DbError>> {
	const parsed = parseJobProgress(job.type, job.progress);
	const counts =
		parsed.type === "unknown"
			? { done: 0, total: 0, succeeded: 0, failed: 0 }
			: {
					done: parsed.progress.done,
					total: parsed.progress.total,
					succeeded: parsed.progress.succeeded,
					failed: parsed.progress.failed,
				};

	try {
		await sql.begin(async (tx) => {
			await tx`
				UPDATE job 
				SET status = ${status}, 
				    completed_at = now(), 
				    error = ${errorMsg ?? null}
				WHERE id = ${job.id}
			`;

			if (eventReason === "completed") {
				await writeAccountEvent(tx, {
					accountId: job.account_id,
					type: "enrichment_completed",
					payload: { jobId: job.id, counts },
				});
			} else {
				await writeAccountEvent(tx, {
					accountId: job.account_id,
					type: "enrichment_stopped",
					payload: { jobId: job.id, reason: eventReason, counts },
				});
			}
		});
		return Result.ok(undefined);
	} catch (error) {
		const message = errorMessage(error);
		return Result.err(
			new DatabaseError({ code: "settlement_failed", message }),
		);
	}
}

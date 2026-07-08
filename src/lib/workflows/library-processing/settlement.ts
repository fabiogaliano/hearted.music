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

			if (reason === "published" && snapshotId) {
				// Emit for both orientations
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
				// Failed might not have a snapshotId. Emit for both if orientation is conceptually "both".
				// Contract allows orientation | null, so we can just emit one event with null.
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

/**
 * Job lifecycle error types.
 */

import { TaggedError } from "better-result";

/** Job was cancelled by user or system */
export class JobCancelledError extends TaggedError("JobCancelledError")<{
	jobId: string;
	reason?: string;
	message: string;
}>() {
	constructor(jobId: string, reason?: string) {
		super({
			jobId,
			reason,
			message: `Job ${jobId} cancelled${reason ? `: ${reason}` : ""}`,
		});
	}
}

/** Job exceeded maximum retries */
export class JobRetriesExhaustedError extends TaggedError(
	"JobRetriesExhaustedError",
)<{
	jobId: string;
	attempts: number;
	message: string;
}>() {
	constructor(jobId: string, attempts: number) {
		super({
			jobId,
			attempts,
			message: `Job ${jobId} failed after ${attempts} attempts`,
		});
	}
}

/** All job lifecycle errors */
export type JobError = JobCancelledError | JobRetriesExhaustedError;

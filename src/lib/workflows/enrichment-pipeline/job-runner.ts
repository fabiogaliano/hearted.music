import { Result } from "better-result";
import { createJob } from "@/lib/data/jobs";
import type { JobProgress } from "@/lib/data/jobs";
import { startJob, finalizeJob } from "@/lib/platform/jobs/lifecycle";
import { emitProgress, emitStatus } from "@/lib/platform/jobs/progress/helpers";
import type { EnrichmentStageName } from "./types";

export async function runTrackedStageJob<T>(params: {
	accountId: string;
	stage: EnrichmentStageName;
	work: (
		jobId: string,
	) => Promise<{ total: number; succeeded: number; failed: number; result: T }>;
}): Promise<{ jobId: string; succeeded: number; failed: number; result: T }> {
	const jobResult = await createJob(params.accountId, params.stage);
	if (Result.isError(jobResult)) {
		throw new Error(`Failed to create job: ${jobResult.error.message}`);
	}
	const jobId = jobResult.value.id;

	const startResult = await startJob(jobId);
	if (Result.isError(startResult)) {
		throw new Error(`Failed to start job: ${startResult.error.message}`);
	}

	const { total, succeeded, failed, result } = await params.work(jobId);

	const progress: JobProgress = { total, done: total, succeeded, failed };
	emitProgress(jobId, progress);

	// finalizeJob returns Result<Job, DbError> — log but don't throw, the work itself already completed
	const finalizeResult = await finalizeJob(jobId, progress);
	if (Result.isError(finalizeResult)) {
		console.error(
			`[job-runner] Failed to finalize job ${jobId}: ${finalizeResult.error.message}`,
		);
	}

	emitStatus(jobId, succeeded > 0 ? "completed" : "failed");

	return { jobId, succeeded, failed, result };
}

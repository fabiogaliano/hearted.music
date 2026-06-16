import { captureException } from "@sentry/bun";

interface WorkerJobFailureContext {
	workflow: "enrichment" | "match_snapshot_refresh";
	jobId: string;
	accountId: string;
}

export function captureWorkerJobFailure(
	error: unknown,
	context: WorkerJobFailureContext,
): void {
	captureException(error, {
		tags: { workflow: context.workflow, phase: "job-execution" },
		extra: { jobId: context.jobId, accountId: context.accountId },
	});
}

import { captureException } from "@sentry/bun";
import type { LibraryProcessingWorkflow } from "@/lib/workflows/library-processing/types";

interface WorkerJobFailureContext {
	workflow: LibraryProcessingWorkflow;
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

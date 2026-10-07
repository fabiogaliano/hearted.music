import { Result } from "better-result";
import { resolveAccountLabel } from "@/lib/observability/account-label";
import { log } from "@/lib/observability/logger";
import { getLatestJobExecutionMeasurement } from "@/lib/platform/jobs/execution-measurements";
import type { Job } from "@/lib/platform/jobs/repository";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { EnrichmentChanges, MatchSnapshotChanges } from "./changes";
import { findTerminalActiveRefs, type TerminalActiveRef } from "./queries";
import { applyLibraryProcessingChange } from "./service";
import type {
	LibraryProcessingApplyError,
	LibraryProcessingApplyOutcome,
	LibraryProcessingChange,
	LibraryProcessingWorkflow,
} from "./types";
import {
	changeOf,
	finalStatusOf,
	workerOutcomeFromMeasurement,
} from "./worker-outcome";

function isLibraryProcessingWorkflow(
	type: string,
): type is LibraryProcessingWorkflow {
	return type === "enrichment" || type === "match_snapshot_refresh";
}

function buildRecoveryChange(job: Job) {
	if (!isLibraryProcessingWorkflow(job.type)) {
		return null;
	}

	switch (job.type) {
		case "enrichment":
			return EnrichmentChanges.stopped({
				accountId: job.account_id,
				jobId: job.id,
				reason: "error",
			});
		case "match_snapshot_refresh":
			return MatchSnapshotChanges.failed({
				accountId: job.account_id,
				jobId: job.id,
			});
	}
}

export interface DeadLetterRecoveryResult {
	jobId: string;
	accountId: string;
	jobType: string;
	outcome: Result<LibraryProcessingApplyOutcome, LibraryProcessingApplyError>;
}

export async function recoverDeadLetteredLibraryProcessingJob(
	job: Job,
): Promise<DeadLetterRecoveryResult | null> {
	const change = buildRecoveryChange(job);
	if (change === null) {
		return null;
	}

	const outcome = await applyLibraryProcessingChange(change);

	return {
		jobId: job.id,
		accountId: job.account_id,
		jobType: job.type,
		outcome,
	};
}

export async function recoverDeadLetteredLibraryProcessingJobs(
	jobs: Job[],
): Promise<DeadLetterRecoveryResult[]> {
	const results: DeadLetterRecoveryResult[] = [];

	for (const job of jobs) {
		const result = await recoverDeadLetteredLibraryProcessingJob(job);
		if (result !== null) {
			results.push(result);
		}
	}

	return results;
}

export interface TerminalRefRecoveryResult {
	jobId: string;
	accountId: string;
	workflow: LibraryProcessingWorkflow;
	jobStatus: string;
	recoveryStrategy: "completed_from_measurement" | "conservative_failure";
	outcome: Result<LibraryProcessingApplyOutcome, LibraryProcessingApplyError>;
}

function conservativeChange(
	workflow: LibraryProcessingWorkflow,
	job: Job,
): LibraryProcessingChange {
	return workflow === "enrichment"
		? EnrichmentChanges.stopped({
				accountId: job.account_id,
				jobId: job.id,
				reason: "error",
			})
		: MatchSnapshotChanges.failed({
				accountId: job.account_id,
				jobId: job.id,
			});
}

async function buildTerminalRefChange(ref: TerminalActiveRef): Promise<{
	change: LibraryProcessingChange;
	strategy: TerminalRefRecoveryResult["recoveryStrategy"];
}> {
	const { workflow, job } = ref;
	const conservative = {
		change: conservativeChange(workflow, job),
		strategy: "conservative_failure" as const,
	};

	// A failed run's change is the conservative one, so its measurement could
	// only confirm it.
	if (job.status === "failed") return conservative;

	const measurementResult = await getLatestJobExecutionMeasurement(job.id);
	if (Result.isError(measurementResult) || !measurementResult.value) {
		return conservative;
	}

	// Trust the measurement only when it describes the ending the job row
	// records; a contradicting row is not this run's outcome.
	const outcome = workerOutcomeFromMeasurement(measurementResult.value);
	if (
		outcome === null ||
		outcome.workflow !== workflow ||
		finalStatusOf(outcome) !== job.status
	) {
		return conservative;
	}

	return { change: changeOf(outcome), strategy: "completed_from_measurement" };
}

export async function recoverTerminalLibraryProcessingRefs(): Promise<
	TerminalRefRecoveryResult[]
> {
	const refsResult = await findTerminalActiveRefs();
	if (Result.isError(refsResult)) {
		log.error("terminal-recovery:find-refs-failed", {
			error: refsResult.error.message,
		});
		return [];
	}

	const results: TerminalRefRecoveryResult[] = [];

	for (const ref of refsResult.value) {
		try {
			const { change, strategy } = await buildTerminalRefChange(ref);
			const outcome = await applyLibraryProcessingChange(change);

			log.info("terminal-recovery:recovered", {
				actor: await resolveAccountLabel(ref.job.account_id),
				workflow: ref.workflow,
				strategy,
				jobStatus: ref.job.status,
				jobId: ref.job.id,
			});

			results.push({
				jobId: ref.job.id,
				accountId: ref.job.account_id,
				workflow: ref.workflow,
				jobStatus: ref.job.status,
				recoveryStrategy: strategy,
				outcome,
			});
		} catch (error) {
			log.error("terminal-recovery:unexpected-error", {
				actor: await resolveAccountLabel(ref.job.account_id),
				workflow: ref.workflow,
				jobId: ref.job.id,
				accountId: ref.job.account_id,
				error: errorMessage(error),
			});
		}
	}

	return results;
}

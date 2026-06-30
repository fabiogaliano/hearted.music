import { Result } from "better-result";
import { resolveAccountLabel } from "@/lib/observability/account-label";
import { log } from "@/lib/observability/logger";
import {
	getLatestJobExecutionMeasurement,
	type JobExecutionMeasurement,
} from "@/lib/platform/jobs/execution-measurements";
import type { Job } from "@/lib/platform/jobs/repository";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { EnrichmentChanges } from "./changes/enrichment";
import { MatchSnapshotChanges } from "./changes/match-snapshot";
import { findTerminalActiveRefs, type TerminalActiveRef } from "./queries";
import { applyLibraryProcessingChange } from "./service";
import type {
	LibraryProcessingApplyError,
	LibraryProcessingApplyOutcome,
	LibraryProcessingChange,
} from "./types";

type LibraryProcessingJobType = "enrichment" | "match_snapshot_refresh";

function isLibraryProcessingJobType(
	type: string,
): type is LibraryProcessingJobType {
	return type === "enrichment" || type === "match_snapshot_refresh";
}

function buildRecoveryChange(job: Job) {
	if (!isLibraryProcessingJobType(job.type)) {
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
	workflow: "enrichment" | "match_snapshot_refresh";
	jobStatus: string;
	recoveryStrategy: "completed_from_measurement" | "conservative_failure";
	outcome: Result<LibraryProcessingApplyOutcome, LibraryProcessingApplyError>;
}

interface EnrichmentMeasurementDetails {
	requestSatisfied: boolean;
	newCandidatesAvailable: boolean;
}

function parseEnrichmentMeasurementDetails(
	measurement: JobExecutionMeasurement,
): EnrichmentMeasurementDetails | null {
	if (measurement.workflow !== "enrichment") return null;
	if (measurement.outcome !== "completed") return null;
	const details = measurement.details;
	if (!details || typeof details !== "object" || Array.isArray(details))
		return null;

	const d = details as Record<string, unknown>;
	if (typeof d.requestSatisfied !== "boolean") return null;
	if (typeof d.newCandidatesAvailable !== "boolean") return null;

	return {
		requestSatisfied: d.requestSatisfied,
		newCandidatesAvailable: d.newCandidatesAvailable,
	};
}

function isMatchSnapshotMeasurementValid(
	measurement: JobExecutionMeasurement,
): boolean {
	if (measurement.workflow !== "match_snapshot_refresh") return false;
	if (measurement.outcome !== "completed") return false;
	const details = measurement.details;
	if (!details || typeof details !== "object" || Array.isArray(details)) {
		return false;
	}

	const d = details as Record<string, unknown>;
	return typeof d.published === "boolean" && typeof d.isEmpty === "boolean";
}

// A completed job whose measurement outcome is "superseded" exited via the
// cooperative cancellation path — not a failure. Recovery replays the
// superseded change so settledAt stays unchanged and the stale workflow
// can re-ensure a fresh job.
function isMatchSnapshotMeasurementSuperseded(
	measurement: JobExecutionMeasurement,
): boolean {
	return (
		measurement.workflow === "match_snapshot_refresh" &&
		measurement.outcome === "superseded"
	);
}

async function buildTerminalRefChange(ref: TerminalActiveRef): Promise<{
	change: LibraryProcessingChange;
	strategy: TerminalRefRecoveryResult["recoveryStrategy"];
}> {
	const { workflow, job } = ref;

	if (job.status === "failed") {
		return {
			change:
				workflow === "enrichment"
					? EnrichmentChanges.stopped({
							accountId: job.account_id,
							jobId: job.id,
							reason: "error",
						})
					: MatchSnapshotChanges.failed({
							accountId: job.account_id,
							jobId: job.id,
						}),
			strategy: "conservative_failure",
		};
	}

	const measurementResult = await getLatestJobExecutionMeasurement(job.id);
	if (Result.isError(measurementResult) || !measurementResult.value) {
		return {
			change:
				workflow === "enrichment"
					? EnrichmentChanges.stopped({
							accountId: job.account_id,
							jobId: job.id,
							reason: "error",
						})
					: MatchSnapshotChanges.failed({
							accountId: job.account_id,
							jobId: job.id,
						}),
			strategy: "conservative_failure",
		};
	}

	if (workflow === "enrichment") {
		const details = parseEnrichmentMeasurementDetails(measurementResult.value);
		if (details) {
			return {
				change: EnrichmentChanges.completed({
					accountId: job.account_id,
					jobId: job.id,
					requestSatisfied: details.requestSatisfied,
					newCandidatesAvailable: details.newCandidatesAvailable,
					// Terminal recovery reconstructs from a measurement record that
					// predates the newCandidateSongIds field; no IDs are available.
					newCandidateSongIds: [],
				}),
				strategy: "completed_from_measurement",
			};
		}
		return {
			change: EnrichmentChanges.stopped({
				accountId: job.account_id,
				jobId: job.id,
				reason: "error",
			}),
			strategy: "conservative_failure",
		};
	}

	if (isMatchSnapshotMeasurementSuperseded(measurementResult.value)) {
		return {
			change: MatchSnapshotChanges.superseded({
				accountId: job.account_id,
				jobId: job.id,
			}),
			strategy: "completed_from_measurement",
		};
	}

	if (isMatchSnapshotMeasurementValid(measurementResult.value)) {
		return {
			change: MatchSnapshotChanges.published({
				accountId: job.account_id,
				jobId: job.id,
			}),
			strategy: "completed_from_measurement",
		};
	}

	return {
		change: MatchSnapshotChanges.failed({
			accountId: job.account_id,
			jobId: job.id,
		}),
		strategy: "conservative_failure",
	};
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

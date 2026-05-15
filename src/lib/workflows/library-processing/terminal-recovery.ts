import { Result } from "better-result";
import type { Job } from "@/lib/data/jobs";
import type {
	LibraryProcessingApplyError,
	LibraryProcessingApplyOutcome,
} from "./types";
import { EnrichmentChanges } from "./changes/enrichment";
import { MatchSnapshotChanges } from "./changes/match-snapshot";
import { applyLibraryProcessingChange } from "./service";

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

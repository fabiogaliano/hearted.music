import { Result } from "better-result";
import { log } from "@/lib/observability/logger";
import { getActiveEnrichmentJob } from "@/lib/platform/jobs/library-processing-queue";
import { getLatestJob } from "@/lib/platform/jobs/repository";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { hasMoreSongsNeedingEnrichmentWork } from "@/lib/workflows/enrichment-pipeline/batch";
import { MaintenanceChanges } from "./changes";
import { findStatesWithoutEnrichmentActiveJob } from "./queries";
import { applyLibraryProcessingChange } from "./service";
import type {
	LibraryProcessingApplyError,
	LibraryProcessingApplyOutcome,
} from "./types";

export interface IdleEnrichmentRecoveryResult {
	accountId: string;
	latestJobStatus: string | null;
	outcome: Result<LibraryProcessingApplyOutcome, LibraryProcessingApplyError>;
}

async function inspectIdleAccount(accountId: string): Promise<{
	latestJobStatus: string | null;
} | null> {
	const [activeJobResult, latestJobResult] = await Promise.all([
		getActiveEnrichmentJob(accountId),
		getLatestJob(accountId, "enrichment"),
	]);

	if (Result.isError(activeJobResult)) {
		log.error("idle-enrichment-recovery-active-job-check-failed", {
			accountId,
			error: activeJobResult.error.message,
		});
		return null;
	}
	if (activeJobResult.value !== null) {
		return null;
	}

	if (Result.isError(latestJobResult)) {
		log.error("idle-enrichment-recovery-latest-job-check-failed", {
			accountId,
			error: latestJobResult.error.message,
		});
		return null;
	}

	const latestJobStatus = latestJobResult.value?.status ?? null;
	if (latestJobStatus === "failed") {
		return null;
	}

	try {
		const hasWork = await hasMoreSongsNeedingEnrichmentWork(accountId);
		if (!hasWork) {
			return null;
		}
	} catch (error) {
		log.error("idle-enrichment-recovery-work-probe-failed", {
			accountId,
			error: errorMessage(error),
		});
		return null;
	}

	return { latestJobStatus };
}

export async function recoverIdleEnrichmentWorkflows(): Promise<
	IdleEnrichmentRecoveryResult[]
> {
	const statesResult = await findStatesWithoutEnrichmentActiveJob();
	if (Result.isError(statesResult)) {
		log.error("idle-enrichment-recovery-find-states-failed", {
			error: statesResult.error.message,
		});
		return [];
	}

	const results: IdleEnrichmentRecoveryResult[] = [];

	for (const state of statesResult.value) {
		const inspection = await inspectIdleAccount(state.accountId);
		if (inspection === null) {
			continue;
		}

		try {
			const outcome = await applyLibraryProcessingChange(
				MaintenanceChanges.enrichmentWorkAvailable(state.accountId),
			);
			results.push({
				accountId: state.accountId,
				latestJobStatus: inspection.latestJobStatus,
				outcome,
			});
		} catch (error) {
			log.error("idle-enrichment-recovery-threw", {
				accountId: state.accountId,
				error: errorMessage(error),
			});
		}
	}

	return results;
}

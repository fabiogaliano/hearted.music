import { Result } from "better-result";
import {
	markDeadLibraryProcessingJobs,
	markDeadWalkthroughPreviewJobs,
	sweepStaleLibraryProcessingJobs,
	sweepStaleWalkthroughPreviewJobs,
	type Job,
} from "@/lib/data/jobs";
import type { DbError } from "@/lib/shared/errors/database";
import {
	recoverDeadLetteredLibraryProcessingJobs,
	type DeadLetterRecoveryResult,
} from "@/lib/workflows/library-processing/terminal-recovery";
import { workerConfig } from "./config";
import { log } from "./logger";

export type SweepRpc = (
	staleThreshold: string,
) => Promise<Result<Job[], DbError>>;

export type RecoverDeadLetteredFn = (
	jobs: Job[],
) => Promise<DeadLetterRecoveryResult[]>;

export type SweepDeps = {
	staleThreshold: string;
	sweepStaleLibraryProcessingJobs: SweepRpc;
	markDeadLibraryProcessingJobs: SweepRpc;
	recoverDeadLetteredLibraryProcessingJobs: RecoverDeadLetteredFn;
	sweepStaleWalkthroughPreviewJobs: SweepRpc;
	markDeadWalkthroughPreviewJobs: SweepRpc;
};

export function createDefaultSweepDeps(): SweepDeps {
	return {
		staleThreshold: workerConfig.staleThreshold,
		sweepStaleLibraryProcessingJobs,
		markDeadLibraryProcessingJobs,
		recoverDeadLetteredLibraryProcessingJobs,
		sweepStaleWalkthroughPreviewJobs,
		markDeadWalkthroughPreviewJobs,
	};
}

export async function runSweepTick(deps: SweepDeps): Promise<void> {
	const swept = await deps.sweepStaleLibraryProcessingJobs(deps.staleThreshold);
	if (Result.isError(swept)) {
		log.error("sweep-error", { error: swept.error.message });
	} else if (swept.value.length > 0) {
		log.info("swept-stale-jobs", {
			count: swept.value.length,
			jobIds: swept.value.map((j) => j.id),
		});
	}

	const dead = await deps.markDeadLibraryProcessingJobs(deps.staleThreshold);
	if (Result.isError(dead)) {
		log.error("dead-letter-error", { error: dead.error.message });
	} else if (dead.value.length > 0) {
		log.warn("dead-lettered-jobs", {
			count: dead.value.length,
			jobIds: dead.value.map((j) => j.id),
		});

		const recoveryResults = await deps.recoverDeadLetteredLibraryProcessingJobs(
			dead.value,
		);

		for (const r of recoveryResults) {
			if (Result.isError(r.outcome)) {
				log.error("dead-letter-recovery-failed", {
					jobId: r.jobId,
					accountId: r.accountId,
					jobType: r.jobType,
					error: r.outcome.error,
				});
			} else {
				log.info("dead-letter-recovered", {
					jobId: r.jobId,
					accountId: r.accountId,
					jobType: r.jobType,
				});
			}
		}
	}

	const sweptPreview = await deps.sweepStaleWalkthroughPreviewJobs(
		deps.staleThreshold,
	);
	if (Result.isError(sweptPreview)) {
		log.error("preview-sweep-error", { error: sweptPreview.error.message });
	} else if (sweptPreview.value.length > 0) {
		log.info("swept-stale-preview-jobs", {
			count: sweptPreview.value.length,
			jobIds: sweptPreview.value.map((j) => j.id),
		});
	}

	const deadPreview = await deps.markDeadWalkthroughPreviewJobs(
		deps.staleThreshold,
	);
	if (Result.isError(deadPreview)) {
		log.error("preview-dead-letter-error", {
			error: deadPreview.error.message,
		});
	} else if (deadPreview.value.length > 0) {
		log.warn("dead-lettered-preview-jobs", {
			count: deadPreview.value.length,
			jobIds: deadPreview.value.map((j) => j.id),
		});
	}
}

export function startSweep(
	deps: SweepDeps,
	intervalMs: number,
): { stop: () => void } {
	const interval = setInterval(() => runSweepTick(deps), intervalMs);
	return { stop: () => clearInterval(interval) };
}

export async function runDefaultSweepTick(): Promise<void> {
	await runSweepTick(createDefaultSweepDeps());
}

export function startDefaultSweep(): { stop: () => void } {
	return startSweep(createDefaultSweepDeps(), workerConfig.sweepIntervalMs);
}

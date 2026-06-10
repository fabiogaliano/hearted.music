import * as Sentry from "@sentry/bun";
import { Result } from "better-result";
import {
	markDeadLibraryProcessingJobs,
	sweepStaleLibraryProcessingJobs,
} from "@/lib/platform/jobs/library-processing-queue";
import type { Job } from "@/lib/platform/jobs/repository";
import {
	markDeadWalkthroughPreviewJobs,
	sweepStaleWalkthroughPreviewJobs,
} from "@/lib/platform/jobs/walkthrough-preview-queue";
import type { DbError } from "@/lib/shared/errors/database";
import { errorMessage } from "@/lib/shared/errors/error-message";
import {
	type DeadLetterRecoveryResult,
	recoverDeadLetteredLibraryProcessingJobs,
	recoverTerminalLibraryProcessingRefs,
	type TerminalRefRecoveryResult,
} from "@/lib/workflows/library-processing/terminal-recovery";
import { workerConfig } from "./config";
import { log } from "./logger";

export type SweepRpc = (
	staleThreshold: string,
) => Promise<Result<Job[], DbError>>;

export type RecoverDeadLetteredFn = (
	jobs: Job[],
) => Promise<DeadLetterRecoveryResult[]>;

export type RecoverTerminalRefsFn = () => Promise<TerminalRefRecoveryResult[]>;

export type SweepDeps = {
	staleThreshold: string;
	sweepStaleLibraryProcessingJobs: SweepRpc;
	markDeadLibraryProcessingJobs: SweepRpc;
	recoverDeadLetteredLibraryProcessingJobs: RecoverDeadLetteredFn;
	recoverTerminalLibraryProcessingRefs: RecoverTerminalRefsFn;
	sweepStaleWalkthroughPreviewJobs: SweepRpc;
	markDeadWalkthroughPreviewJobs: SweepRpc;
};

export function createDefaultSweepDeps(): SweepDeps {
	return {
		staleThreshold: workerConfig.staleThreshold,
		sweepStaleLibraryProcessingJobs,
		markDeadLibraryProcessingJobs,
		recoverDeadLetteredLibraryProcessingJobs,
		recoverTerminalLibraryProcessingRefs,
		sweepStaleWalkthroughPreviewJobs,
		markDeadWalkthroughPreviewJobs,
	};
}

// Each sweep step is an independent maintenance task, so an unexpected throw in
// one must not abort the others or escape the tick. The Result-returning RPCs
// already surface their own errors; this catches the non-Result paths (the
// recover* calls) and any future throw, keeping runSweepTick total — it never
// rejects, so the fire-and-forget scheduler can't crash the worker.
async function runStep(step: string, fn: () => Promise<void>): Promise<void> {
	try {
		await fn();
	} catch (error) {
		log.error("sweep-step-threw", { step, error: errorMessage(error) });
		Sentry.captureException(error, { tags: { phase: "sweep-tick", step } });
	}
}

export async function runSweepTick(deps: SweepDeps): Promise<void> {
	await runStep("sweep-stale-library-jobs", async () => {
		const swept = await deps.sweepStaleLibraryProcessingJobs(
			deps.staleThreshold,
		);
		if (Result.isError(swept)) {
			log.error("sweep-error", { error: swept.error.message });
		} else if (swept.value.length > 0) {
			log.info("swept-stale-jobs", {
				count: swept.value.length,
				jobIds: swept.value.map((j) => j.id),
			});
		}
	});

	await runStep("recover-dead-letters", async () => {
		const dead = await deps.markDeadLibraryProcessingJobs(deps.staleThreshold);
		if (Result.isError(dead)) {
			log.error("dead-letter-error", { error: dead.error.message });
			return;
		}
		if (dead.value.length === 0) return;

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
	});

	await runStep("recover-terminal-refs", async () => {
		const terminalRefResults =
			await deps.recoverTerminalLibraryProcessingRefs();
		for (const r of terminalRefResults) {
			if (Result.isError(r.outcome)) {
				log.error("terminal-ref-recovery-failed", {
					jobId: r.jobId,
					accountId: r.accountId,
					workflow: r.workflow,
					jobStatus: r.jobStatus,
					recoveryStrategy: r.recoveryStrategy,
					error: r.outcome.error,
				});
			} else {
				log.info("terminal-ref-recovered", {
					jobId: r.jobId,
					accountId: r.accountId,
					workflow: r.workflow,
					jobStatus: r.jobStatus,
					recoveryStrategy: r.recoveryStrategy,
				});
			}
		}
	});

	await runStep("sweep-stale-preview-jobs", async () => {
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
	});

	await runStep("mark-dead-preview-jobs", async () => {
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
	});
}

export function startSweep(
	deps: SweepDeps,
	intervalMs: number,
): { stop: () => void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	// Self-scheduling timeout rather than setInterval: the next tick is queued
	// only after the current one settles, so a slow tick can never overlap with
	// the next and double-process the same rows.
	const scheduleNext = () => {
		if (stopped) return;
		timer = setTimeout(() => {
			void runSweepTick(deps)
				.catch((error) => {
					// runSweepTick is total via runStep; this is a backstop so an
					// unexpected throw outside the steps still can't crash the worker.
					log.error("sweep-tick-threw", { error: errorMessage(error) });
					Sentry.captureException(error, { tags: { phase: "sweep-tick" } });
				})
				.finally(scheduleNext);
		}, intervalMs);
	};

	scheduleNext();
	return {
		stop: () => {
			stopped = true;
			if (timer !== null) clearTimeout(timer);
		},
	};
}

export async function runDefaultSweepTick(): Promise<void> {
	await runSweepTick(createDefaultSweepDeps());
}

export function startDefaultSweep(): { stop: () => void } {
	return startSweep(createDefaultSweepDeps(), workerConfig.sweepIntervalMs);
}

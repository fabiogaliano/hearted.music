import * as Sentry from "@sentry/bun";
import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { log } from "@/lib/observability/logger";
import {
	claimExtensionSyncPayloadCleanup,
	markDeadExtensionSyncJobs,
	sweepStaleExtensionSyncJobs,
} from "@/lib/platform/jobs/extension-sync-jobs";
import {
	markDeadLibraryProcessingJobs,
	sweepStaleLibraryProcessingJobs,
} from "@/lib/platform/jobs/library-processing-queue";
import type { Job } from "@/lib/platform/jobs/repository";
import type { DbError } from "@/lib/shared/errors/database";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { deleteOrphanedSyncPayloads } from "@/lib/workflows/extension-sync/payload-cleanup";
import { deleteSyncPayload } from "@/lib/workflows/extension-sync/payload-storage";
import {
	type DeadLetterRecoveryResult,
	recoverDeadLetteredLibraryProcessingJobs,
	recoverTerminalLibraryProcessingRefs,
	type TerminalRefRecoveryResult,
} from "@/lib/workflows/library-processing/terminal-recovery";
import { workerConfig } from "./config";

export type SweepRpc = (
	staleThreshold: string,
) => Promise<Result<Job[], DbError>>;

export type RecoverDeadLetteredFn = (
	jobs: Job[],
) => Promise<DeadLetterRecoveryResult[]>;

export type RecoverTerminalRefsFn = () => Promise<TerminalRefRecoveryResult[]>;

export type DeleteOrphanedPayloadsFn = (jobs: Job[]) => Promise<void>;

export type ClaimPayloadCleanupFn = () => Promise<
	Result<{ jobId: string; accountId: string; payloadPath: string }[], DbError>
>;

export type DeleteSyncPayloadFn = (
	path: string,
) => Promise<Result<void, DbError>>;

export type SweepDeps = {
	staleThreshold: string;
	sweepStaleLibraryProcessingJobs: SweepRpc;
	markDeadLibraryProcessingJobs: SweepRpc;
	recoverDeadLetteredLibraryProcessingJobs: RecoverDeadLetteredFn;
	recoverTerminalLibraryProcessingRefs: RecoverTerminalRefsFn;
	sweepStaleExtensionSyncJobs: SweepRpc;
	markDeadExtensionSyncJobs: SweepRpc;
	deleteOrphanedSyncPayloads: DeleteOrphanedPayloadsFn;
	claimExtensionSyncPayloadCleanup: ClaimPayloadCleanupFn;
	deleteSyncPayload: DeleteSyncPayloadFn;
};

export function createDefaultSweepDeps(): SweepDeps {
	return {
		staleThreshold: workerConfig.staleThreshold,
		sweepStaleLibraryProcessingJobs,
		markDeadLibraryProcessingJobs,
		recoverDeadLetteredLibraryProcessingJobs,
		recoverTerminalLibraryProcessingRefs,
		sweepStaleExtensionSyncJobs,
		markDeadExtensionSyncJobs,
		deleteOrphanedSyncPayloads,
		claimExtensionSyncPayloadCleanup,
		deleteSyncPayload: (path) =>
			deleteSyncPayload(createAdminSupabaseClient(), path),
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

	await runStep("sweep-stale-extension-sync-jobs", async () => {
		const swept = await deps.sweepStaleExtensionSyncJobs(deps.staleThreshold);
		if (Result.isError(swept)) {
			log.error("extension-sync-sweep-error", { error: swept.error.message });
		} else if (swept.value.length > 0) {
			log.info("swept-stale-extension-sync-jobs", {
				count: swept.value.length,
				jobIds: swept.value.map((j) => j.id),
			});
		}
	});

	await runStep("mark-dead-extension-sync-jobs", async () => {
		const dead = await deps.markDeadExtensionSyncJobs(deps.staleThreshold);
		if (Result.isError(dead)) {
			log.error("extension-sync-dead-letter-error", {
				error: dead.error.message,
			});
			return;
		}
		if (dead.value.length === 0) return;

		log.warn("dead-lettered-extension-sync-jobs", {
			count: dead.value.length,
			jobIds: dead.value.map((j) => j.id),
		});
		// The SQL dead-letter can't reach Storage; delete each dead job's
		// now-orphaned payload here using the pointer in its progress.
		await deps.deleteOrphanedSyncPayloads(dead.value);
	});

	// Payload-pointer cleanup: covers self-healed parents (whose runner never ran
	// so the object was never deleted inline), completed jobs whose runner delete
	// failed, and any other terminal path that left the pointer. Runs after the
	// dead-letter step so newly-dead-lettered rows are already handled above and
	// both paths remain correct. SKIP LOCKED in the RPC means concurrent ticks
	// never double-process. Stripping the pointer atomically is the claim; if the
	// Storage call fails afterward the object leaks (logged below; acceptable risk).
	await runStep("cleanup-extension-sync-payloads", async () => {
		const claimed = await deps.claimExtensionSyncPayloadCleanup();
		if (Result.isError(claimed)) {
			log.error("extension-sync-payload-cleanup-error", {
				error: claimed.error.message,
			});
			return;
		}
		if (claimed.value.length === 0) return;

		log.info("extension-sync-payload-cleanup", {
			count: claimed.value.length,
			jobIds: claimed.value.map((r) => r.jobId),
		});

		await Promise.all(
			claimed.value.map(async (r) => {
				const deleteResult = await deps.deleteSyncPayload(r.payloadPath);
				if (Result.isError(deleteResult)) {
					// Pointer already stripped from DB; the object leaks but the quota
					// impact is bounded and logged for manual recovery if needed.
					log.warn("extension-sync-payload-cleanup-delete-failed", {
						jobId: r.jobId,
						accountId: r.accountId,
						payloadPath: r.payloadPath,
						error: deleteResult.error.message,
					});
				}
			}),
		);
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

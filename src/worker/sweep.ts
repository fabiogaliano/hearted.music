import * as Sentry from "@sentry/bun";
import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	markDeadDeckJobs,
	sweepStaleDeckJobs,
} from "@/lib/domains/taste/match-review-queue/deck-jobs";
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
import { errorMessage } from "@/lib/shared/errors/error-message";
import { deleteOrphanedSyncPayloads } from "@/lib/workflows/extension-sync/payload-cleanup";
import { deleteSyncPayload } from "@/lib/workflows/extension-sync/payload-storage";
import { recoverIdleEnrichmentWorkflows } from "@/lib/workflows/library-processing/idle-recovery";
import {
	recoverDeadLetteredLibraryProcessingJobs,
	recoverTerminalLibraryProcessingRefs,
} from "@/lib/workflows/library-processing/terminal-recovery";
import { workerConfig } from "./config";

// Shared with mark_dead (H1): a 'running' deck job only dead-letters once its
// heartbeat is older than this same lease, so sweep's reclaim and mark_dead's
// dead-letter agree on what "still running" means and a job on its final
// attempt is never marked dead while still genuinely executing.
const DECK_JOB_LEASE_SECONDS = 900;

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

export async function runSweepTick(): Promise<void> {
	const { staleThreshold } = workerConfig;
	await runStep("sweep-stale-library-jobs", async () => {
		const swept = await sweepStaleLibraryProcessingJobs(staleThreshold);
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
		const dead = await markDeadLibraryProcessingJobs(staleThreshold);
		if (Result.isError(dead)) {
			log.error("dead-letter-error", { error: dead.error.message });
			return;
		}
		if (dead.value.length === 0) return;

		log.warn("dead-lettered-jobs", {
			count: dead.value.length,
			jobIds: dead.value.map((j) => j.id),
		});

		const recoveryResults = await recoverDeadLetteredLibraryProcessingJobs(
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
		const terminalRefResults = await recoverTerminalLibraryProcessingRefs();
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
		const swept = await sweepStaleExtensionSyncJobs(staleThreshold);
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
		const dead = await markDeadExtensionSyncJobs(staleThreshold);
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
		await deleteOrphanedSyncPayloads(dead.value);
	});

	// Payload-pointer cleanup: covers self-healed parents (whose runner never ran
	// so the object was never deleted inline), completed jobs whose runner delete
	// failed, and any other terminal path that left the pointer. Runs after the
	// dead-letter step so newly-dead-lettered rows are already handled above and
	// both paths remain correct. SKIP LOCKED in the RPC means concurrent ticks
	// never double-process. Stripping the pointer atomically is the claim; if the
	// Storage call fails afterward the object leaks (logged below; acceptable risk).
	await runStep("cleanup-extension-sync-payloads", async () => {
		const claimed = await claimExtensionSyncPayloadCleanup();
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
				const deleteResult = await deleteSyncPayload(
					createAdminSupabaseClient(),
					r.payloadPath,
				);
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

	await runStep("sweep-stale-deck-jobs", async () => {
		const swept = await sweepStaleDeckJobs(DECK_JOB_LEASE_SECONDS);
		if (Result.isError(swept)) {
			log.error("match-deck-sweep-error", { error: swept.error.message });
		} else if (swept.value.length > 0) {
			log.warn("match-deck-swept-stale-jobs", {
				count: swept.value.length,
				jobIds: swept.value.map((j) => j.id),
			});
		}
	});

	await runStep("mark-dead-deck-jobs", async () => {
		const dead = await markDeadDeckJobs(DECK_JOB_LEASE_SECONDS);
		if (Result.isError(dead)) {
			log.error("match-deck-mark-dead-error", { error: dead.error.message });
			return;
		}
		for (const job of dead.value) {
			log.error("match-deck-job-dead-lettered", {
				jobId: job.id,
				kind: job.kind,
				accountId: job.account_id,
				orientation: job.orientation,
			});
			Sentry.captureMessage(
				`match deck job dead-lettered: ${job.kind}`,
				"error",
			);
		}
	});
}

export function startSweep(): { stop: () => void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	// Self-scheduling timeout rather than setInterval: the next tick is queued
	// only after the current one settles, so a slow tick can never overlap with
	// the next and double-process the same rows.
	const scheduleNext = () => {
		if (stopped) return;
		timer = setTimeout(() => {
			void runSweepTick()
				.catch((error) => {
					// runSweepTick is total via runStep; this is a backstop so an
					// unexpected throw outside the steps still can't crash the worker.
					log.error("sweep-tick-threw", { error: errorMessage(error) });
					Sentry.captureException(error, { tags: { phase: "sweep-tick" } });
				})
				.finally(scheduleNext);
		}, workerConfig.sweepIntervalMs);
	};

	scheduleNext();
	return {
		stop: () => {
			stopped = true;
			if (timer !== null) clearTimeout(timer);
		},
	};
}

// Idle recovery is a safety net for a missed library-processing wake, not a
// queue drain: it probes every idle account's whole library (2 job lookups +
// a full selector scan each), so at the 60s sweep cadence it was the largest
// steady source of API traffic. Its own slower cadence bounds that cost.
export async function runIdleEnrichmentRecoveryTick(): Promise<void> {
	await runStep("recover-idle-enrichment", async () => {
		const idleRecoveryResults = await recoverIdleEnrichmentWorkflows();
		for (const r of idleRecoveryResults) {
			if (Result.isError(r.outcome)) {
				log.error("idle-enrichment-recovery-failed", {
					accountId: r.accountId,
					latestJobStatus: r.latestJobStatus,
					error: r.outcome.error,
				});
			} else {
				log.info("idle-enrichment-recovered", {
					accountId: r.accountId,
					latestJobStatus: r.latestJobStatus,
				});
			}
		}
	});
}

export function startIdleEnrichmentRecovery(): { stop: () => void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	const scheduleNext = () => {
		if (stopped) return;
		timer = setTimeout(() => {
			void runIdleEnrichmentRecoveryTick().finally(scheduleNext);
		}, workerConfig.idleEnrichmentRecoveryIntervalMs);
	};

	scheduleNext();
	return {
		stop: () => {
			stopped = true;
			if (timer !== null) clearTimeout(timer);
		},
	};
}

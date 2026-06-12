/**
 * Worker poll loop for extension_sync parent jobs.
 *
 * Sibling to the library-processing and walkthrough-preview loops: runs in the
 * same worker binary but uses a dedicated claim RPC so a long-running library
 * sync can neither starve enrichment nor be starved by it.
 *
 * The claim-and-dispatch cycle is factored out as a standalone function so the
 * LISTEN/NOTIFY listener (src/worker/notify-listener.ts) can drive it on a
 * `job_created` notification; this poll loop is the at-most-once-delivery
 * safety net at a relaxed interval.
 */

import { Result } from "better-result";
import { resolveAccountLabel } from "@/lib/observability/account-label";
import { log } from "@/lib/observability/logger";
import { claimExtensionSyncJob } from "@/lib/platform/jobs/extension-sync-jobs";
import type { Job } from "@/lib/platform/jobs/repository";
import { runExtensionSyncJob } from "@/lib/workflows/extension-sync/runner";
import { workerConfig } from "./config";
import { startHeartbeat } from "./execute";

let shouldPoll = true;
const activeJobs = new Set<string>();

export function stopExtensionSyncPolling() {
	shouldPoll = false;
}

export function getActiveExtensionSyncJobCount() {
	return activeJobs.size;
}

function dispatch(job: Job, actor: string): void {
	const { id: jobId, account_id: accountId } = job;
	activeJobs.add(jobId);
	(async () => {
		const heartbeat = startHeartbeat(jobId);
		try {
			const outcome = await runExtensionSyncJob(job, actor);
			if (outcome.status === "completed") {
				log.info("extension-sync-job-complete", { actor, jobId, accountId });
			} else {
				log.warn("extension-sync-job-failed", {
					actor,
					jobId,
					accountId,
					error: outcome.error,
				});
			}
		} catch (error) {
			log.error("extension-sync-job-threw", {
				actor,
				jobId,
				accountId,
				error: String(error),
			});
		} finally {
			heartbeat.stop();
			activeJobs.delete(jobId);
		}
	})();
}

/**
 * Claims and dispatches pending extension_sync jobs until either the queue is
 * empty or the concurrency cap is reached. Safe to call concurrently with the
 * poll loop and the notify listener — claims go through SKIP LOCKED, so a job
 * is dispatched at most once. Never throws.
 */
export async function claimAndDispatchExtensionSyncJobs(): Promise<void> {
	while (shouldPoll && activeJobs.size < workerConfig.concurrency) {
		const claimResult = await claimExtensionSyncJob();
		if (Result.isError(claimResult)) {
			log.error("extension-sync-claim-error", {
				error: claimResult.error.message,
			});
			return;
		}

		const job = claimResult.value;
		if (!job) return;

		const actor = await resolveAccountLabel(job.account_id);
		log.info("extension-sync-job-claimed", {
			actor,
			jobId: job.id,
			accountId: job.account_id,
		});
		dispatch(job, actor);
	}
}

export async function startExtensionSyncPolling(): Promise<void> {
	shouldPoll = true;
	log.info("extension-sync-polling-start", {
		concurrency: workerConfig.concurrency,
		intervalMs: workerConfig.extensionSyncPollIntervalMs,
	});

	while (shouldPoll) {
		await claimAndDispatchExtensionSyncJobs();
		await Bun.sleep(workerConfig.extensionSyncPollIntervalMs);
	}

	log.info("extension-sync-polling-stopped");
}

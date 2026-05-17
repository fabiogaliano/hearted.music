/**
 * Worker poll loop for walkthrough_match_preview jobs.
 *
 * Sibling to the library-processing poll loop. Runs concurrently in the same
 * worker binary so onboarding previews can be picked up without standing up a
 * separate deployment, but uses a dedicated claim RPC so a stuck preview job
 * cannot starve enrichment / match snapshot refresh.
 */

import { Result } from "better-result";

import { claimWalkthroughPreviewJob } from "@/lib/platform/jobs/walkthrough-preview-queue";
import { runWalkthroughPreviewJob } from "@/lib/workflows/walkthrough-match-preview/runner";

import { workerConfig } from "./config";
import { startHeartbeat } from "./execute";
import { log } from "./logger";

let shouldPoll = true;
const activeJobs = new Set<string>();

export function stopWalkthroughPreviewPolling() {
	shouldPoll = false;
}

export function getActiveWalkthroughPreviewJobCount() {
	return activeJobs.size;
}

export async function startWalkthroughPreviewPolling(): Promise<void> {
	shouldPoll = true;
	log.info("walkthrough-preview-polling-start", {
		intervalMs: workerConfig.pollIntervalMs,
	});

	while (shouldPoll) {
		// Cap concurrency at 1 — preview jobs are expected to be infrequent (one
		// per onboarding session) and doing one at a time keeps the cold-start
		// cost (embedding service init, profile cache) predictable.
		if (activeJobs.size >= 1) {
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		const claimResult = await claimWalkthroughPreviewJob();
		if (Result.isError(claimResult)) {
			log.error("walkthrough-preview-claim-error", {
				error: claimResult.error.message,
			});
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		const job = claimResult.value;
		if (!job) {
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		activeJobs.add(job.id);
		log.info("walkthrough-preview-job-claimed", {
			jobId: job.id,
			accountId: job.account_id,
		});

		(async () => {
			const heartbeat = startHeartbeat(job.id);
			try {
				const outcome = await runWalkthroughPreviewJob(job);
				if (outcome.status === "completed") {
					log.info("walkthrough-preview-job-complete", {
						jobId: job.id,
						accountId: job.account_id,
						previewStatus: outcome.result.status,
						matchedPlaylists: outcome.result.matchedPlaylists,
					});
				} else {
					log.warn("walkthrough-preview-job-failed", {
						jobId: job.id,
						accountId: job.account_id,
						error: outcome.error,
					});
				}
			} finally {
				heartbeat.stop();
				activeJobs.delete(job.id);
			}
		})();
	}

	log.info("walkthrough-preview-polling-stopped");
}

import { Result } from "better-result";
import { claimLibraryProcessingJob } from "@/lib/data/jobs";
import { runClaimedJob } from "@/lib/workflows/library-processing/runner";
import { workerConfig } from "./config";
import { startHeartbeat } from "./execute";
import { log } from "./logger";

let shouldPoll = true;
const activeJobs = new Set<string>();

export function stopPolling() {
	shouldPoll = false;
}

export function getActiveJobCount() {
	return activeJobs.size;
}

export async function startPolling(): Promise<void> {
	shouldPoll = true;
	log.info("polling-start", {
		concurrency: workerConfig.concurrency,
		intervalMs: workerConfig.pollIntervalMs,
	});

	while (shouldPoll) {
		if (activeJobs.size >= workerConfig.concurrency) {
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		const claimResult = await claimLibraryProcessingJob();
		if (Result.isError(claimResult)) {
			log.error("claim-error", { error: claimResult.error.message });
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		const job = claimResult.value;
		if (!job) {
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		activeJobs.add(job.id);
		log.info("job-claimed", {
			jobId: job.id,
			type: job.type,
			accountId: job.account_id,
		});

		(async () => {
			const heartbeat = startHeartbeat(job.id);
			try {
				const outcome = await runClaimedJob(job);
				if (outcome.status === "completed") {
					log.info("job-complete", {
						jobId: job.id,
						workflow: outcome.workflow,
						accountId: job.account_id,
					});
				}
			} catch {
				// Already logged + marked failed inside runner
			} finally {
				heartbeat.stop();
				activeJobs.delete(job.id);
			}
		})();
	}

	log.info("polling-stopped");
}

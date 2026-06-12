import { Result } from "better-result";
import { resolveAccountLabel } from "@/lib/observability/account-label";
import { log } from "@/lib/observability/logger";
import { claimLibraryProcessingJob } from "@/lib/platform/jobs/library-processing-queue";
import { runClaimedJob } from "@/lib/workflows/library-processing/runner";
import { workerConfig } from "./config";
import { startHeartbeat } from "./execute";

let shouldPoll = true;
const activeJobs = new Set<string>();

function describeWork(type: string): string {
	switch (type) {
		case "enrichment":
			return "enriching library";
		case "match_snapshot_refresh":
			return "re-matching songs";
		default:
			return type;
	}
}

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
		const actor = await resolveAccountLabel(job.account_id);
		log.info("job-claimed", {
			actor,
			work: describeWork(job.type),
			jobId: job.id,
			accountId: job.account_id,
		});

		(async () => {
			const heartbeat = startHeartbeat(job.id);
			try {
				const outcome = await runClaimedJob(job, actor);
				if (outcome.status === "completed") {
					log.info("job-complete", {
						actor,
						work: describeWork(job.type),
						jobId: job.id,
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

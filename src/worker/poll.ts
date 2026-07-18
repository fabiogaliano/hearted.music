import { resolveAccountLabel } from "@/lib/observability/account-label";
import { log } from "@/lib/observability/logger";
import { claimLibraryProcessingJob } from "@/lib/platform/jobs/library-processing-queue";
import type { Job } from "@/lib/platform/jobs/repository";
import { runClaimedJob } from "@/lib/workflows/library-processing/runner";
import { workerConfig } from "./config";
import { startHeartbeat } from "./execute";
import { createPollLoop } from "./poll-loop";

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

const loop = createPollLoop<Job, { message: string }>({
	concurrency: () => workerConfig.concurrency,
	claim: claimLibraryProcessingJob,
	jobId: (job) => job.id,
	onClaimError: (error) => log.error("claim-error", { error: error.message }),
	dispatch: async (job, markDone) => {
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
				markDone();
			}
		})();
	},
	pollIntervalMs: workerConfig.pollIntervalMs,
	onLoopStart: () =>
		log.info("polling-start", {
			concurrency: workerConfig.concurrency,
			intervalMs: workerConfig.pollIntervalMs,
		}),
	onLoopStop: () => log.info("polling-stopped"),
});

export function stopPolling() {
	loop.stop();
}

export function getActiveJobCount() {
	return loop.getActiveCount();
}

export async function claimAndDispatchLibraryProcessingJobs(): Promise<void> {
	return loop.claimAndDispatch();
}

export async function startPolling(): Promise<void> {
	return loop.start();
}

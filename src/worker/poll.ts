import { Result } from "better-result";
import {
	claimEnrichmentJob,
	markJobCompleted,
	markJobFailed,
} from "@/lib/data/jobs";
import {
	updateEnrichmentJobId,
	clearEnrichmentJobId,
} from "@/lib/domains/library/accounts/preferences-queries";
import { chainNextChunk } from "./chain";
import { workerConfig } from "./config";
import { executeJob } from "./execute";
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
	log.info("polling-start", {
		concurrency: workerConfig.concurrency,
		intervalMs: workerConfig.pollIntervalMs,
	});

	while (shouldPoll) {
		if (activeJobs.size >= workerConfig.concurrency) {
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		const result = await claimEnrichmentJob();

		if (Result.isError(result)) {
			log.error("claim-error", { error: result.error.message });
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		if (!result.value) {
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		const job = result.value;
		activeJobs.add(job.id);
		log.info("job-claimed", { jobId: job.id, accountId: job.account_id });

		(async () => {
			try {
				const result = await executeJob(job);

				const completedResult = await markJobCompleted(job.id);
				if (Result.isError(completedResult)) {
					log.error("mark-completed-failed", {
						jobId: job.id,
						error: completedResult.error.message,
					});
				}
				log.info("job-complete", { jobId: job.id, accountId: job.account_id });

				try {
					const outcome = await chainNextChunk(
						result.accountId,
						result.batchSequence,
						result.hasMoreSongs,
					);
					switch (outcome.status) {
						case "chained": {
							const updateResult = await updateEnrichmentJobId(
								result.accountId,
								outcome.jobId,
							);
							if (Result.isError(updateResult)) {
								log.error("update-enrichment-pointer-failed", {
									accountId: result.accountId,
									error: updateResult.error.message,
								});
							}
							break;
						}
						case "completed": {
							const clearResult = await clearEnrichmentJobId(result.accountId);
							if (Result.isError(clearResult)) {
								log.error("clear-enrichment-pointer-failed", {
									accountId: result.accountId,
									error: clearResult.error.message,
								});
							}
							break;
						}
						case "error": {
							log.error("chain-error", {
								jobId: job.id,
								accountId: job.account_id,
								error: outcome.error,
							});
							const clearResult = await clearEnrichmentJobId(result.accountId);
							if (Result.isError(clearResult)) {
								log.error("clear-enrichment-pointer-failed", {
									accountId: result.accountId,
									error: clearResult.error.message,
								});
							}
							break;
						}
					}
				} catch (chainError) {
					const message =
						chainError instanceof Error
							? chainError.message
							: String(chainError);
					log.error("chain-error", {
						jobId: job.id,
						accountId: job.account_id,
						error: message,
					});
					const clearResult = await clearEnrichmentJobId(result.accountId);
					if (Result.isError(clearResult)) {
						log.error("clear-enrichment-pointer-failed", {
							accountId: result.accountId,
							error: clearResult.error.message,
						});
					}
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				try {
					const failResult = await markJobFailed(job.id, message);
					if (Result.isError(failResult)) {
						log.error("mark-failed-error", {
							jobId: job.id,
							error: failResult.error.message,
						});
					}
				} catch (markError) {
					log.error("mark-failed-error", {
						jobId: job.id,
						error:
							markError instanceof Error
								? markError.message
								: String(markError),
					});
				}
				log.error("job-failed", {
					jobId: job.id,
					accountId: job.account_id,
					error: message,
				});
			} finally {
				activeJobs.delete(job.id);
			}
		})();
	}

	log.info("polling-stopped");
}

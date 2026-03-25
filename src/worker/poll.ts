import { Result } from "better-result";
import type { Job } from "@/lib/data/jobs";
import {
	claimEnrichmentJob,
	claimTargetPlaylistMatchRefreshJob,
	markJobCompleted,
	markJobFailed,
} from "@/lib/data/jobs";
import {
	updateEnrichmentJobId,
	clearEnrichmentJobId,
	clearTargetPlaylistMatchRefreshJobId,
} from "@/lib/domains/library/accounts/preferences-queries";
import { requestRefreshAfterDrain } from "@/lib/workflows/enrichment-pipeline/trigger";
import { chainNextChunk } from "./chain";
import { workerConfig } from "./config";
import { executeJob, executeTargetPlaylistMatchRefreshJob } from "./execute";
import { log } from "./logger";

let shouldPoll = true;
const activeJobs = new Set<string>();

export function stopPolling() {
	shouldPoll = false;
}

export function getActiveJobCount() {
	return activeJobs.size;
}

async function processEnrichmentJob(job: Job): Promise<void> {
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
					// Queue drain — request target-playlist refresh if targets exist
					const refreshJobId = await requestRefreshAfterDrain(result.accountId);
					if (refreshJobId) {
						log.info("drain-triggered-refresh", {
							accountId: result.accountId,
							refreshJobId,
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
				chainError instanceof Error ? chainError.message : String(chainError);
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
		await markJobFailedSafe(job, message);
		throw error;
	}
}

async function processTargetPlaylistMatchRefreshJob(job: Job): Promise<void> {
	try {
		await executeTargetPlaylistMatchRefreshJob(job);

		const completedResult = await markJobCompleted(job.id);
		if (Result.isError(completedResult)) {
			log.error("mark-completed-failed", {
				jobId: job.id,
				error: completedResult.error.message,
			});
		}
		log.info("target-refresh-job-complete", {
			jobId: job.id,
			accountId: job.account_id,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await markJobFailedSafe(job, message);
		throw error;
	} finally {
		const clearResult = await clearTargetPlaylistMatchRefreshJobId(
			job.account_id,
		);
		if (Result.isError(clearResult)) {
			log.error("clear-refresh-pointer-failed", {
				accountId: job.account_id,
				error: clearResult.error.message,
			});
		}
	}
}

async function markJobFailedSafe(job: Job, message: string): Promise<void> {
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
			error: markError instanceof Error ? markError.message : String(markError),
		});
	}
	log.error("job-failed", {
		jobId: job.id,
		accountId: job.account_id,
		error: message,
	});
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

		// Enrichment gets priority — candidate-side work gates suggestions
		let job: Job | null = null;

		const enrichResult = await claimEnrichmentJob();
		if (Result.isError(enrichResult)) {
			log.error("claim-error", { error: enrichResult.error.message });
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}
		job = enrichResult.value;

		// Target-playlist refresh gets second priority
		if (!job) {
			const refreshResult = await claimTargetPlaylistMatchRefreshJob();
			if (Result.isError(refreshResult)) {
				log.error("claim-refresh-error", {
					error: refreshResult.error.message,
				});
				await Bun.sleep(workerConfig.pollIntervalMs);
				continue;
			}
			job = refreshResult.value;
		}

		if (!job) {
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		const claimed = job;
		activeJobs.add(claimed.id);
		log.info("job-claimed", {
			jobId: claimed.id,
			type: claimed.type,
			accountId: claimed.account_id,
		});

		(async () => {
			try {
				if (claimed.type === "target_playlist_match_refresh") {
					await processTargetPlaylistMatchRefreshJob(claimed);
				} else {
					await processEnrichmentJob(claimed);
				}
			} catch {
				// Already logged + marked failed inside process* functions
			} finally {
				activeJobs.delete(claimed.id);
			}
		})();
	}

	log.info("polling-stopped");
}

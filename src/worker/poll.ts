import { Result } from "better-result";
import type { Job } from "@/lib/data/jobs";
import {
	claimEnrichmentJob,
	claimLightweightEnrichmentJob,
	claimRematchJob,
	markJobCompleted,
	markJobFailed,
} from "@/lib/data/jobs";
import {
	updateEnrichmentJobId,
	clearEnrichmentJobId,
	clearRematchJobId,
} from "@/lib/domains/library/accounts/preferences-queries";
import { chainNextChunk } from "./chain";
import { workerConfig } from "./config";
import {
	executeJob,
	executeLightweightEnrichmentJob,
	executeRematchJob,
} from "./execute";
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

async function processLightweightEnrichmentJob(job: Job): Promise<void> {
	try {
		await executeLightweightEnrichmentJob(job);

		const completedResult = await markJobCompleted(job.id);
		if (Result.isError(completedResult)) {
			log.error("mark-completed-failed", {
				jobId: job.id,
				error: completedResult.error.message,
			});
		}
		log.info("lightweight-enrichment-job-complete", {
			jobId: job.id,
			accountId: job.account_id,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await markJobFailedSafe(job, message);
		throw error;
	}
}

async function processRematchJob(job: Job): Promise<void> {
	try {
		await executeRematchJob(job);

		const completedResult = await markJobCompleted(job.id);
		if (Result.isError(completedResult)) {
			log.error("mark-completed-failed", {
				jobId: job.id,
				error: completedResult.error.message,
			});
		}
		log.info("rematch-job-complete", {
			jobId: job.id,
			accountId: job.account_id,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await markJobFailedSafe(job, message);
		throw error;
	} finally {
		const clearResult = await clearRematchJobId(job.account_id);
		if (Result.isError(clearResult)) {
			log.error("clear-rematch-pointer-failed", {
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

		// Enrichment gets priority — gates first-time results
		let job: Job | null = null;

		const enrichResult = await claimEnrichmentJob();
		if (Result.isError(enrichResult)) {
			log.error("claim-error", { error: enrichResult.error.message });
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}
		job = enrichResult.value;

		// Lightweight enrichment gets second priority — enriches destination playlist songs
		if (!job) {
			const lightweightResult = await claimLightweightEnrichmentJob();
			if (Result.isError(lightweightResult)) {
				log.error("claim-lightweight-error", {
					error: lightweightResult.error.message,
				});
			} else {
				job = lightweightResult.value;
			}
		}

		if (!job) {
			const rematchResult = await claimRematchJob();
			if (Result.isError(rematchResult)) {
				log.error("claim-rematch-error", {
					error: rematchResult.error.message,
				});
				await Bun.sleep(workerConfig.pollIntervalMs);
				continue;
			}
			job = rematchResult.value;
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
				if (claimed.type === "playlist_lightweight_enrichment") {
					await processLightweightEnrichmentJob(claimed);
				} else if (claimed.type === "rematch") {
					await processRematchJob(claimed);
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

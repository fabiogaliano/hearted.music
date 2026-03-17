import { Result } from "better-result";
import type { Job } from "@/lib/data/jobs";
import { updateHeartbeat } from "@/lib/data/jobs";
import type { EnrichmentChunkProgress } from "@/lib/platform/jobs/progress/types";
import { executeWorkerChunk } from "@/lib/workflows/enrichment-pipeline/orchestrator";
import { workerConfig } from "./config";
import { log } from "./logger";

export interface ExecuteResult {
	hasMoreSongs: boolean;
	accountId: string;
	batchSequence: number;
}

function startHeartbeat(jobId: string): { stop: () => void } {
	const interval = setInterval(async () => {
		const result = await updateHeartbeat(jobId);
		if (Result.isError(result)) {
			log.warn("heartbeat-failed", { jobId, error: result.error.message });
		}
	}, workerConfig.heartbeatIntervalMs);
	return { stop: () => clearInterval(interval) };
}

export async function executeJob(job: Job): Promise<ExecuteResult> {
	const heartbeat = startHeartbeat(job.id);
	const accountId = job.account_id;
	const progress = (job.progress ?? {}) as Partial<EnrichmentChunkProgress>;

	log.info("job-start", {
		jobId: job.id,
		accountId,
		batchSize: progress.batchSize,
		sequence: progress.batchSequence,
	});

	try {
		const result = await executeWorkerChunk(
			accountId,
			job.id,
			progress.batchSize ?? 5,
			progress.batchSequence ?? 0,
		);

		return {
			hasMoreSongs: result.hasMoreSongs,
			accountId,
			batchSequence: progress.batchSequence ?? 0,
		};
	} finally {
		heartbeat.stop();
	}
}

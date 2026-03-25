import { Result } from "better-result";
import type { Job } from "@/lib/data/jobs";
import {
	getJobById,
	updateHeartbeat,
	updateJobProgress,
} from "@/lib/data/jobs";
import type { EnrichmentChunkProgress } from "@/lib/platform/jobs/progress/types";
import { executeWorkerChunk } from "@/lib/workflows/enrichment-pipeline/orchestrator";
import { executeRefresh } from "@/lib/workflows/target-playlist-match-refresh/orchestrator";
import type { TargetPlaylistRefreshPlan } from "@/lib/workflows/target-playlist-match-refresh/types";
import { workerConfig } from "./config";
import { log } from "./logger";

export interface ExecuteResult {
	hasMoreSongs: boolean;
	accountId: string;
	batchSequence: number;
}

export function startHeartbeat(jobId: string): { stop: () => void } {
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

/**
 * Executes a target-playlist match refresh job.
 * Runs the refresh orchestrator, then checks rerunRequested for a follow-up pass.
 */
export async function executeTargetPlaylistMatchRefreshJob(
	job: Job,
): Promise<void> {
	const heartbeat = startHeartbeat(job.id);
	const accountId = job.account_id;
	const initialProgress = (job.progress ?? {}) as Record<string, unknown>;
	let plan = (initialProgress.plan ?? {
		source: "manual",
		shouldEnrichTargetPlaylistSongs: false,
	}) as TargetPlaylistRefreshPlan;

	log.info("target-refresh-start", { jobId: job.id, accountId });

	try {
		let pass = 0;
		while (true) {
			const result = await executeRefresh(accountId, plan);

			log.info(
				pass === 0
					? "target-refresh-complete"
					: "target-refresh-rerun-complete",
				{
					jobId: job.id,
					accountId,
					published: result.published,
					matched: result.matchedSongCount,
					candidates: result.candidateCount,
					playlists: result.playlistCount,
					noOp: result.noOp,
					isEmpty: result.isEmpty,
					pass,
				},
			);

			const freshJobResult = await getJobById(job.id);
			const freshProgress =
				Result.isOk(freshJobResult) && freshJobResult.value
					? ((freshJobResult.value.progress ?? {}) as Record<string, unknown>)
					: initialProgress;

			if (!freshProgress.rerunRequested) {
				break;
			}

			log.info("target-refresh-rerun", {
				jobId: job.id,
				accountId,
				pass: pass + 1,
			});
			await updateJobProgress(job.id, {
				...freshProgress,
				rerunRequested: false,
			} as any);

			const latestPlan = (freshProgress.plan ??
				plan) as TargetPlaylistRefreshPlan;
			plan = {
				...latestPlan,
				shouldEnrichTargetPlaylistSongs: true,
			};
			pass += 1;
		}
	} finally {
		heartbeat.stop();
	}
}

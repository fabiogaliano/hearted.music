import { Result } from "better-result";
import type { Job } from "@/lib/data/jobs";
import { updateHeartbeat } from "@/lib/data/jobs";
import type { EnrichmentChunkProgress } from "@/lib/platform/jobs/progress/types";
import type { ChunkResult } from "@/lib/workflows/enrichment-pipeline/orchestrator";
import { executeWorkerChunk } from "@/lib/workflows/enrichment-pipeline/orchestrator";
import { executeRefresh } from "@/lib/workflows/target-playlist-match-refresh/orchestrator";
import type { TargetPlaylistRefreshPlan } from "@/lib/workflows/target-playlist-match-refresh/types";
import type { RefreshResult } from "@/lib/workflows/target-playlist-match-refresh/types";
import { workerConfig } from "./config";
import { log } from "./logger";

export interface EnrichmentExecuteResult {
	accountId: string;
	jobId: string;
	batchSequence: number;
	hasMoreSongs: boolean;
	newCandidatesAvailable: boolean;
}

export interface RefreshExecuteResult {
	accountId: string;
	jobId: string;
	published: boolean;
	isEmpty: boolean;
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

export async function executeEnrichmentJob(
	job: Job,
): Promise<EnrichmentExecuteResult> {
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
		const result: ChunkResult = await executeWorkerChunk(
			accountId,
			job.id,
			progress.batchSize ?? 5,
			progress.batchSequence ?? 0,
		);

		return {
			accountId,
			jobId: job.id,
			batchSequence: progress.batchSequence ?? 0,
			hasMoreSongs: result.hasMoreSongs,
			newCandidatesAvailable: result.newCandidatesAvailable,
		};
	} finally {
		heartbeat.stop();
	}
}

/**
 * Executes a match_snapshot_refresh job as a single pass.
 * No rerun loop — if a new change arrives, library-processing ensures a later job.
 */
export async function executeMatchSnapshotRefreshJob(
	job: Job,
): Promise<RefreshExecuteResult> {
	const heartbeat = startHeartbeat(job.id);
	const accountId = job.account_id;
	const initialProgress = (job.progress ?? {}) as Record<string, unknown>;
	const plan = (initialProgress.plan ?? {
		shouldEnrichTargetPlaylistSongs: false,
	}) as TargetPlaylistRefreshPlan;

	log.info("match-snapshot-refresh-start", { jobId: job.id, accountId });

	try {
		const result: RefreshResult = await executeRefresh(accountId, plan);

		log.info("match-snapshot-refresh-complete", {
			jobId: job.id,
			accountId,
			published: result.published,
			matched: result.matchedSongCount,
			candidates: result.candidateCount,
			playlists: result.playlistCount,
			noOp: result.noOp,
			isEmpty: result.isEmpty,
		});

		return {
			accountId,
			jobId: job.id,
			published: result.published || result.noOp,
			isEmpty: result.isEmpty,
		};
	} finally {
		heartbeat.stop();
	}
}

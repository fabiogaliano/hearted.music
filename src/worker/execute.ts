import { Result } from "better-result";
import type { Job } from "@/lib/data/jobs";
import { updateHeartbeat } from "@/lib/data/jobs";
import {
	type EnrichmentChunkProgress,
	EnrichmentChunkProgressSchema,
} from "@/lib/platform/jobs/progress/enrichment";
import type { ChunkResult } from "@/lib/workflows/enrichment-pipeline/orchestrator";
import { executeWorkerChunk } from "@/lib/workflows/enrichment-pipeline/orchestrator";
import type { WorkflowDevServerSettings } from "@/lib/workflows/library-processing/devtools/settings";
import { executeMatchSnapshotRefresh } from "@/lib/workflows/match-snapshot-refresh/orchestrator";
import {
	type MatchSnapshotRefreshPlan,
	MatchSnapshotRefreshPlanSchema,
	type MatchSnapshotRefreshResult,
} from "@/lib/workflows/match-snapshot-refresh/types";
import { workerConfig } from "./config";
import { log } from "./logger";

export interface EnrichmentExecuteResult {
	accountId: string;
	jobId: string;
	batchSequence: number;
	hasMoreSongs: boolean;
	newCandidatesAvailable: boolean;
	readyCount: number;
	doneCount: number;
	succeededCount: number;
	failedCount: number;
}

export interface MatchSnapshotRefreshExecuteResult {
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
	settings?: WorkflowDevServerSettings,
): Promise<EnrichmentExecuteResult> {
	const accountId = job.account_id;
	const progressResult = EnrichmentChunkProgressSchema.partial().safeParse(
		job.progress ?? {},
	);
	const progress: Partial<EnrichmentChunkProgress> = progressResult.success
		? progressResult.data
		: {};

	log.info("job-start", {
		jobId: job.id,
		accountId,
		batchSize: progress.batchSize,
		sequence: progress.batchSequence,
	});

	const result: ChunkResult = await executeWorkerChunk(
		accountId,
		job.id,
		progress.batchSize ?? 1,
		progress.batchSequence ?? 0,
		settings?.enrichmentStageDelayMs,
	);

	return {
		accountId,
		jobId: job.id,
		batchSequence: progress.batchSequence ?? 0,
		hasMoreSongs: result.hasMoreSongs,
		newCandidatesAvailable: result.newCandidatesAvailable,
		readyCount: result.readyCount,
		doneCount: result.doneCount,
		succeededCount: result.succeededCount,
		failedCount: result.failedCount,
	};
}

export async function executeMatchSnapshotRefreshJob(
	job: Job,
	settings?: WorkflowDevServerSettings,
): Promise<MatchSnapshotRefreshExecuteResult> {
	const accountId = job.account_id;
	const initialProgress =
		typeof job.progress === "object" && job.progress !== null
			? job.progress
			: {};
	const planValue =
		"plan" in initialProgress ? initialProgress.plan : undefined;
	const planResult = MatchSnapshotRefreshPlanSchema.safeParse(planValue);
	const plan: MatchSnapshotRefreshPlan = planResult.success
		? planResult.data
		: { needsTargetSongEnrichment: false };

	log.info("match-snapshot-refresh-start", { jobId: job.id, accountId });

	const result: MatchSnapshotRefreshResult = await executeMatchSnapshotRefresh(
		accountId,
		plan,
		job.id,
		settings?.refreshStageDelayMs,
	);

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
		published: result.published,
		isEmpty: result.isEmpty,
	};
}

import { Result } from "better-result";
import { log } from "@/lib/observability/logger";
import {
	type EnrichmentChunkProgress,
	EnrichmentChunkProgressSchema,
} from "@/lib/platform/jobs/progress/enrichment";
import { type Job, updateHeartbeat } from "@/lib/platform/jobs/repository";
import type { ChunkResult } from "@/lib/workflows/enrichment-pipeline/orchestrator";
import { executeWorkerChunk } from "@/lib/workflows/enrichment-pipeline/orchestrator";
import { executeMatchSnapshotRefresh } from "@/lib/workflows/match-snapshot-refresh/orchestrator";
import {
	type MatchSnapshotRefreshPlan,
	MatchSnapshotRefreshPlanSchema,
	type MatchSnapshotRefreshResult,
} from "@/lib/workflows/match-snapshot-refresh/types";
import { workerConfig } from "./config";

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
	actor: string,
): Promise<EnrichmentExecuteResult> {
	const accountId = job.account_id;
	const progressResult = EnrichmentChunkProgressSchema.partial().safeParse(
		job.progress ?? {},
	);
	const progress: Partial<EnrichmentChunkProgress> = progressResult.success
		? progressResult.data
		: {};

	// First batch of a run is the "new process" moment; later batches are
	// continuations, so keep them lower-key.
	const isFirstBatch = (progress.batchSequence ?? 0) === 0;
	log.info(isFirstBatch ? "▶ ENRICH RUN" : "enrich:batch", {
		actor,
		batch: progress.batchSequence,
		batchSize: progress.batchSize,
		jobId: job.id,
		accountId,
	});

	const result: ChunkResult = await executeWorkerChunk(
		accountId,
		job.id,
		progress.batchSize ?? 1,
		progress.batchSequence ?? 0,
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
	actor: string,
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

	log.info("▶ MATCH RUN", { actor, jobId: job.id, accountId });

	const result: MatchSnapshotRefreshResult = await executeMatchSnapshotRefresh(
		accountId,
		plan,
		job.id,
		actor,
	);

	log.info("■ MATCH DONE", {
		actor,
		matched: result.matchedSongCount,
		candidates: result.candidateCount,
		playlists: result.playlistCount,
		published: result.published,
		noOp: result.noOp,
		isEmpty: result.isEmpty,
		jobId: job.id,
		accountId,
	});

	return {
		accountId,
		jobId: job.id,
		published: result.published,
		isEmpty: result.isEmpty,
	};
}

import * as Sentry from "@sentry/bun";
import { Result } from "better-result";
import { log } from "@/lib/observability/logger";
import type { EnrichmentSelectionMode } from "@/lib/platform/jobs/progress/enrichment";
import { parseJobProgress } from "@/lib/platform/jobs/progress/parse";
import { type Job, updateHeartbeat } from "@/lib/platform/jobs/repository";
import type { ChunkResult } from "@/lib/workflows/enrichment-pipeline/orchestrator";
import { executeWorkerChunk } from "@/lib/workflows/enrichment-pipeline/orchestrator";
import { executeMatchSnapshotRefresh } from "@/lib/workflows/match-snapshot-refresh/orchestrator";
import {
	type MatchSnapshotRefreshPlan,
	MatchSnapshotRefreshPlanSchema,
} from "@/lib/workflows/match-snapshot-refresh/types";
import { workerConfig } from "./config";
import { captureWorkerEvent } from "./posthog-capture";

export interface EnrichmentExecuteResult {
	accountId: string;
	jobId: string;
	batchSequence: number;
	hasMoreSongs: boolean;
	newCandidatesAvailable: boolean;
	newCandidateSongIds: string[];
	selectionMode: EnrichmentSelectionMode;
	readyCount: number;
	doneCount: number;
	succeededCount: number;
	failedCount: number;
}

export type MatchSnapshotRefreshExecuteResult =
	| {
			status: "published";
			accountId: string;
			jobId: string;
			published: boolean;
			isEmpty: boolean;
	  }
	| { status: "superseded"; accountId: string; jobId: string };

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
	// Route through the canonical parse so fillEnrichmentDefaults guarantees all
	// fields — including selectionMode — are non-optional. The "unknown" branch
	// cannot fire for a valid DB enrichment job (jsonb column is always an object),
	// so throw rather than silently swallow a malformed row.
	const parsed = parseJobProgress("enrichment", job.progress ?? {});
	if (parsed.type !== "enrichment") {
		throw new Error(
			`Unexpected progress format for enrichment job ${job.id}: type=${parsed.type}`,
		);
	}
	const progress = parsed.progress;

	// First batch of a run is the "new process" moment; later batches are
	// continuations, so keep them lower-key.
	const isFirstBatch = progress.batchSequence === 0;
	log.info(isFirstBatch ? "▶ ENRICH RUN" : "enrich:batch", {
		actor,
		batch: progress.batchSequence,
		batchSize: progress.batchSize,
		jobId: job.id,
		accountId,
	});

	// batchSize=0 is the fillEnrichmentDefaults sentinel for "not yet set";
	// promote it to 1 so the very first chunk loads at least one song.
	const batchSize = progress.batchSize || 1;

	const result: ChunkResult = await executeWorkerChunk(
		accountId,
		job.id,
		batchSize,
		progress.batchSequence,
		progress.selectionMode,
	);

	return {
		accountId,
		jobId: job.id,
		batchSequence: progress.batchSequence,
		hasMoreSongs: result.hasMoreSongs,
		newCandidatesAvailable: result.newCandidatesAvailable,
		newCandidateSongIds: result.newCandidateSongIds,
		selectionMode: progress.selectionMode,
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

	const outcome = await executeMatchSnapshotRefresh(
		accountId,
		plan,
		job.id,
		actor,
		job.satisfies_requested_at ?? undefined,
	);

	if (outcome.status === "superseded") {
		log.info("■ MATCH SUPERSEDED", { actor, jobId: job.id, accountId });
		return { status: "superseded", accountId, jobId: job.id };
	}

	const result = outcome.result;

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

	// Funnel step 2 (intent → snapshot → review): records that matching ran to
	// completion and what it produced. Fired here at the worker boundary so the
	// orchestrator stays free of analytics side effects. Superseded jobs are
	// skipped above — they never published.
	// Best-effort: the snapshot is already published, so a PostHog config/flush
	// failure must not turn a completed match job into a failed one. Use
	// @sentry/bun directly (not the Cloudflare-only captureServerError).
	try {
		captureWorkerEvent({
			distinctId: accountId,
			event: "match_snapshot_published",
			properties: {
				published: result.published,
				is_empty: result.isEmpty,
				no_op: result.noOp,
				matched_song_count: result.matchedSongCount,
				candidate_count: result.candidateCount,
				playlist_count: result.playlistCount,
				// snapshot_id is null on a no-op (same hash, no new row written)
				snapshot_id: result.snapshotId,
			},
		});
	} catch (error) {
		Sentry.captureException(error, {
			tags: {
				area: "analytics",
				operation: "capture_match_snapshot_published",
				runtime: "worker",
			},
			extra: {
				accountId,
				jobId: job.id,
				event: "match_snapshot_published",
			},
		});
	}

	return {
		status: "published",
		accountId,
		jobId: job.id,
		published: result.published,
		isEmpty: result.isEmpty,
	};
}

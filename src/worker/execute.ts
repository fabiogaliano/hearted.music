import * as Sentry from "@sentry/bun";
import { Result } from "better-result";
import {
	enqueueMissingProposalBuilds,
	enqueueProposalRebuild,
} from "@/lib/domains/taste/match-review-queue/proposal-rebuild";
import { getLatestMatchSnapshot } from "@/lib/domains/taste/song-matching/queries";
import { log } from "@/lib/observability/logger";
import { parseJobProgress } from "@/lib/platform/jobs/progress/parse";
import type { Job } from "@/lib/platform/jobs/repository";
import type { ChunkResult } from "@/lib/workflows/enrichment-pipeline/orchestrator";
import { executeWorkerChunk } from "@/lib/workflows/enrichment-pipeline/orchestrator";
import type { EnrichmentExecuteResult } from "@/lib/workflows/enrichment-pipeline/types";
import { executeMatchSnapshotRefresh } from "@/lib/workflows/match-snapshot-refresh/orchestrator";
import {
	type MatchSnapshotRefreshExecuteResult,
	type MatchSnapshotRefreshPlan,
	MatchSnapshotRefreshPlanSchema,
	type MatchSnapshotRefreshResult,
} from "@/lib/workflows/match-snapshot-refresh/types";
import { captureWorkerEvent } from "./posthog-capture";

export async function executeEnrichmentJob(
	job: Job,
	actor: string,
	leaseLost: AbortSignal,
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
		job,
		batchSize,
		progress.batchSequence,
		progress.selectionMode,
		leaseLost,
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
		totalCount: result.totalCount,
		succeededCount: result.succeededCount,
		failedCount: result.failedCount,
	};
}

export async function executeMatchSnapshotRefreshJob(
	job: Job,
	actor: string,
	leaseLost: AbortSignal,
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
		job,
		actor,
		job.satisfies_requested_at ?? undefined,
		leaseLost,
	);

	if (outcome.status === "superseded") {
		log.info("■ MATCH SUPERSEDED", { actor, jobId: job.id, accountId });
		return { status: "superseded", accountId, jobId: job.id };
	}

	if (outcome.status === "lease_lost" || leaseLost.aborted) {
		return { status: "lease_lost", accountId, jobId: job.id };
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

	await enqueueDeckProposalBuilds(job, result);

	return {
		status: "published",
		accountId,
		jobId: job.id,
		published: result.published,
		isEmpty: result.isEmpty,
		snapshotId: result.snapshotId,
	};
}

/**
 * Deck read model (plan §6, R2): a fresh published snapshot triggers proposal
 * building for BOTH orientations; each build_proposals handler then chains
 * append_sessions. A no-op refresh enqueues only the latest snapshot's builds
 * that never produced a ready proposal. Enqueued here at the worker boundary so the orchestrator
 * stays side-effect free. Best-effort: the snapshot is already durable and the
 * read path self-heals on a proposal miss, so an enqueue failure must not fail
 * a completed match job.
 */
async function enqueueDeckProposalBuilds(
	job: Job,
	result: MatchSnapshotRefreshResult,
): Promise<void> {
	const accountId = job.account_id;
	const report = (
		error: unknown,
		operation: string,
		extra: { orientation?: string; snapshotId?: string },
	) =>
		Sentry.captureException(error, {
			tags: { area: "match_deck", operation, runtime: "worker" },
			extra: { accountId, jobId: job.id, ...extra },
		});

	if (result.published && result.snapshotId) {
		const snapshotId = result.snapshotId;
		for (const failure of await enqueueProposalRebuild(accountId, snapshotId)) {
			report(failure.error, failure.step, {
				orientation: failure.orientation,
				snapshotId,
			});
		}
		return;
	}
	if (!result.noOp) return;

	// A no-op still owes the builds when an earlier run of this job published
	// the same snapshot and died before enqueueing them: the rerun's publish
	// names no snapshot, so it targets the latest one, which has this hash.
	const latest = await getLatestMatchSnapshot(accountId);
	if (Result.isError(latest)) {
		report(latest.error, "resolve_latest_snapshot", {});
		return;
	}
	if (!latest.value) return;
	const snapshotId = latest.value.id;
	for (const failure of await enqueueMissingProposalBuilds(
		accountId,
		snapshotId,
	)) {
		report(failure.error, failure.step, {
			orientation: failure.orientation,
			snapshotId,
		});
	}
}

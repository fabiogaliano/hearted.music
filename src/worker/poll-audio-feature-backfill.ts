/**
 * Poll loop + stale-lease sweep for yt-dlp audio-feature backfill jobs.
 *
 * Runs as its own loop with a dedicated claim RPC so a slow download (or the
 * ReccoBeats rate limit) can't starve enrichment/preview/extension-sync work.
 * Concurrency is audioFeatureBackfillConfig.concurrency (1); horizontal replicas
 * additionally share the DB-backed ReccoBeats provider lease.
 */

import { hostname } from "node:os";
import * as Sentry from "@sentry/bun";
import { Result } from "better-result";
import {
	claimBackfillJobs,
	heartbeatBackfillJob,
	sweepStaleBackfillJobs,
} from "@/lib/domains/enrichment/audio-feature-backfill/jobs";
import { processBackfillJob } from "@/lib/domains/enrichment/audio-feature-backfill/service";
import type { BackfillJob } from "@/lib/domains/enrichment/audio-feature-backfill/types";
import { wakeEnrichmentForSong } from "@/lib/domains/enrichment/audio-feature-backfill/wake";
import { audioFeatureBackfillConfig } from "@/lib/integrations/youtube-audio/config";
import { log } from "@/lib/observability/logger";
import type { DbError } from "@/lib/shared/errors/database";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { workerConfig } from "./config";
import { createPollLoop } from "./poll-loop";

// Stable per-process id so the settlement RPCs can fence writes to this worker.
const WORKER_ID = `audio-backfill-${hostname()}-${process.pid}`;
// Long enough to cover a download plus three rate-limited clip uploads; the
// sweep reclaims anything whose lease expires (crash/kill).
const CLAIM_LEASE_SECONDS = 900;

export async function runClaimedAudioFeatureBackfillJob(
	job: BackfillJob,
): Promise<void> {
	const heartbeat = setInterval(() => {
		void heartbeatBackfillJob(job.id, WORKER_ID, CLAIM_LEASE_SECONDS).then(
			(result) => {
				if (Result.isError(result)) {
					log.warn("audio-backfill-heartbeat-failed", {
						jobId: job.id,
						error: result.error.message,
					});
				}
			},
		);
	}, workerConfig.heartbeatIntervalMs);

	try {
		const outcome = await processBackfillJob(
			job,
			WORKER_ID,
			workerConfig.ytdlpProxy,
		);
		log.info("audio-backfill-job-settled", {
			jobId: job.id,
			songId: job.song_id,
			outcome,
		});
	} catch (err) {
		// processBackfillJob is defensive (defers on throw), but guard the loop.
		log.error("audio-backfill-job-threw", {
			jobId: job.id,
			error: errorMessage(err),
		});
		Sentry.captureException(err, {
			tags: { loop: "audio-feature-backfill" },
		});
	} finally {
		clearInterval(heartbeat);
	}
}

// The claim RPC returns a batch (limit=1 here); the shared poll loop expects
// a single-job claim, so unwrap the array to preserve the pre-refactor
// "claim one, dispatch immediately" shape.
const loop = createPollLoop<BackfillJob, DbError>({
	concurrency: () => audioFeatureBackfillConfig.concurrency,
	claim: async () => {
		const result = await claimBackfillJobs(WORKER_ID, 1, CLAIM_LEASE_SECONDS);
		if (Result.isError(result)) return result;
		return Result.ok(result.value[0] ?? null);
	},
	jobId: (job) => job.id,
	onClaimError: (error) =>
		log.error("audio-backfill-claim-error", { error: error.message }),
	dispatch: (job, markDone) => {
		void runClaimedAudioFeatureBackfillJob(job).finally(markDone);
	},
	pollIntervalMs: workerConfig.pollIntervalMs,
	onLoopStart: () =>
		log.info("audio-backfill-polling-start", {
			workerId: WORKER_ID,
			concurrency: audioFeatureBackfillConfig.concurrency,
		}),
	onLoopStop: () => log.info("audio-backfill-polling-stopped"),
});

export function stopAudioFeatureBackfillPolling(): void {
	loop.stop();
}

export function getActiveAudioFeatureBackfillJobCount(): number {
	return loop.getActiveCount();
}

export async function startAudioFeatureBackfillPolling(): Promise<void> {
	return loop.start();
}

export async function runAudioFeatureBackfillSweepTick(): Promise<void> {
	const swept = await sweepStaleBackfillJobs();
	if (Result.isError(swept)) {
		log.error("audio-backfill-sweep-error", { error: swept.error.message });
		return;
	}
	if (swept.value.length > 0) {
		log.warn("audio-backfill-swept-stale-jobs", {
			count: swept.value.length,
			jobIds: swept.value.map((j) => j.id),
		});
	}

	// A sweep can terminalize an exhausted lease to `failed`. The selector hides
	// backfill_active songs from analysis, so wake enrichment on that transition
	// or the song waits on a worker that already gave up.
	for (const job of swept.value) {
		if (job.status === "failed") {
			await wakeEnrichmentForSong(job.song_id);
		}
	}
}

export function startAudioFeatureBackfillSweep(): { stop: () => void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	const scheduleNext = () => {
		if (stopped) return;
		timer = setTimeout(() => {
			void runAudioFeatureBackfillSweepTick()
				.catch((error) => {
					log.error("audio-backfill-sweep-tick-threw", {
						error: errorMessage(error),
					});
					Sentry.captureException(error, {
						tags: { phase: "audio-backfill-sweep" },
					});
				})
				.finally(scheduleNext);
		}, workerConfig.sweepIntervalMs);
	};

	scheduleNext();
	return {
		stop: () => {
			stopped = true;
			if (timer !== null) clearTimeout(timer);
		},
	};
}

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
	sweepStaleBackfillJobs,
} from "@/lib/domains/enrichment/audio-feature-backfill/jobs";
import { processBackfillJob } from "@/lib/domains/enrichment/audio-feature-backfill/service";
import { wakeEnrichmentForSong } from "@/lib/domains/enrichment/audio-feature-backfill/wake";
import { audioFeatureBackfillConfig } from "@/lib/integrations/youtube-audio/config";
import { log } from "@/lib/observability/logger";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { workerConfig } from "./config";

// Stable per-process id so the settlement RPCs can fence writes to this worker.
const WORKER_ID = `audio-backfill-${hostname()}-${process.pid}`;
// Long enough to cover a download plus three rate-limited clip uploads; the
// sweep reclaims anything whose lease expires (crash/kill).
const CLAIM_LEASE_SECONDS = 900;

let shouldPoll = false;
const activeJobs = new Set<string>();

export function stopAudioFeatureBackfillPolling(): void {
	shouldPoll = false;
}

export function getActiveAudioFeatureBackfillJobCount(): number {
	return activeJobs.size;
}

export async function startAudioFeatureBackfillPolling(): Promise<void> {
	shouldPoll = true;
	log.info("audio-backfill-polling-start", {
		workerId: WORKER_ID,
		concurrency: audioFeatureBackfillConfig.concurrency,
	});

	while (shouldPoll) {
		if (activeJobs.size >= audioFeatureBackfillConfig.concurrency) {
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		const claimResult = await claimBackfillJobs(
			WORKER_ID,
			1,
			CLAIM_LEASE_SECONDS,
		);
		if (Result.isError(claimResult)) {
			log.error("audio-backfill-claim-error", {
				error: claimResult.error.message,
			});
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		const job = claimResult.value[0];
		if (!job) {
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		activeJobs.add(job.id);
		void (async () => {
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
				activeJobs.delete(job.id);
			}
		})();
	}

	log.info("audio-backfill-polling-stopped");
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

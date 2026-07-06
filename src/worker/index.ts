import * as Sentry from "@sentry/bun";
import { log } from "@/lib/observability/logger";
import { workerConfig } from "./config";
import { startDatabaseBackupScheduler } from "./db-backup";
import { setWorkerFatalObserver } from "./fatal-handlers";
import { setShuttingDown, setUnhealthy, startHealthServer } from "./health";
import { startKeepAlive } from "./keep-alive";
import { startJobCreatedListener } from "./notify-listener";
import { getActiveJobCount, startPolling, stopPolling } from "./poll";
import {
	getActiveAudioFeatureBackfillJobCount,
	runAudioFeatureBackfillSweepTick,
	startAudioFeatureBackfillPolling,
	startAudioFeatureBackfillSweep,
	stopAudioFeatureBackfillPolling,
} from "./poll-audio-feature-backfill";
import {
	claimAndDispatchExtensionSyncJobs,
	getActiveExtensionSyncJobCount,
	startExtensionSyncPolling,
	stopExtensionSyncPolling,
} from "./poll-extension-sync";
import {
	getActiveMatchDeckJobCount,
	runMatchDeckJobSweepTick,
	startMatchDeckJobPolling,
	startMatchDeckJobSweep,
	stopMatchDeckJobPolling,
} from "./poll-match-deck-jobs";
import { shutdownWorkerPostHog } from "./posthog-capture";
import { shutdownPostHogOtel } from "./posthog-otel";
import { runDefaultSweepTick, startDefaultSweep } from "./sweep";

setWorkerFatalObserver((error, phase) => {
	log.error(phase, { error: String(error) });
	setUnhealthy();
});

let draining = false;

async function main() {
	log.info("worker-starting", { config: workerConfig });

	const healthServer = startHealthServer();
	log.info("health-server-started", { port: healthServer.port });

	const keepAlive = startKeepAlive();
	const dbBackup = startDatabaseBackupScheduler();

	// Awaited startup recovery pass. If the previous worker crashed mid-job, a
	// stale row may still be `running` and holding a unique active-job index,
	// blocking fresh work for that account. Running the sweep before any poll
	// loop or claim path opens means the loops start from a clean slate.
	await runDefaultSweepTick();
	// Reclaim any backfill job whose worker died mid-run before the loop opens,
	// so an expired lease can't keep the selector wedged in backfill_active.
	await runAudioFeatureBackfillSweepTick();
	// Reclaim any deck job whose worker died mid-run (stale heartbeat) and
	// dead-letter exhausted ones before the deck poll loop opens.
	await runMatchDeckJobSweepTick();

	const sweep = startDefaultSweep();
	const audioBackfillSweep = startAudioFeatureBackfillSweep();
	const matchDeckSweep = startMatchDeckJobSweep();

	// Primary wake-up for extension sync: a job_created NOTIFY drains the queue
	// immediately; the poll loop is the at-most-once-delivery safety net.
	const notifyListener = startJobCreatedListener(() => {
		void claimAndDispatchExtensionSyncJobs();
	});

	const shutdown = async (signal: string) => {
		if (draining) return;
		draining = true;
		log.info("shutdown-initiated", { signal });

		setShuttingDown();
		stopPolling();
		stopExtensionSyncPolling();
		stopAudioFeatureBackfillPolling();
		stopMatchDeckJobPolling();
		await notifyListener.stop();
		keepAlive.stop();
		dbBackup.stop();
		sweep.stop();
		audioBackfillSweep.stop();
		matchDeckSweep.stop();

		const deadline = Date.now() + workerConfig.drainTimeoutMs;
		const drainPending = () =>
			getActiveJobCount() > 0 ||
			getActiveExtensionSyncJobCount() > 0 ||
			getActiveAudioFeatureBackfillJobCount() > 0 ||
			getActiveMatchDeckJobCount() > 0;
		while (drainPending() && Date.now() < deadline) {
			log.info("draining", {
				activeJobs: getActiveJobCount(),
				activeExtensionSyncJobs: getActiveExtensionSyncJobCount(),
				activeAudioBackfillJobs: getActiveAudioFeatureBackfillJobCount(),
				activeMatchDeckJobs: getActiveMatchDeckJobCount(),
				remainingMs: deadline - Date.now(),
			});
			await Bun.sleep(1000);
		}

		if (drainPending()) {
			log.warn("drain-timeout", {
				activeJobs: getActiveJobCount(),
				activeExtensionSyncJobs: getActiveExtensionSyncJobCount(),
				activeAudioBackfillJobs: getActiveAudioFeatureBackfillJobCount(),
				activeMatchDeckJobs: getActiveMatchDeckJobCount(),
			});
		}

		healthServer.stop();
		await shutdownPostHogOtel();
		// Drain any buffered product events (e.g. match_snapshot_published) before
		// exit so the last jobs' analytics aren't lost on redeploy.
		await shutdownWorkerPostHog();
		// Flush queued events (e.g. exceptions from jobs interrupted mid-drain)
		// before exit, matching the fatal-path flush in main().catch.
		await Sentry.flush(2000);
		log.info("worker-stopped");
		process.exit(0);
	};

	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));

	// Extension sync runs its own loop with a dedicated claim RPC so a large
	// library sync can't starve enrichment work.
	const extensionSyncLoop = startExtensionSyncPolling().catch((err) => {
		log.error("extension-sync-poll-loop-error", { error: String(err) });
		Sentry.captureException(err, {
			tags: { loop: "extension-sync" },
		});
	});

	// Audio-feature backfill runs its own loop with a dedicated claim RPC,
	// isolating slow yt-dlp downloads + rate-limited ReccoBeats uploads from the
	// other workflows.
	const audioBackfillLoop = startAudioFeatureBackfillPolling().catch((err) => {
		log.error("audio-backfill-poll-loop-error", { error: String(err) });
		Sentry.captureException(err, {
			tags: { loop: "audio-feature-backfill" },
		});
	});

	// Match deck jobs run their own single-slot loop with a dedicated claim RPC,
	// draining publish→build→append and capture-ahead off the request path.
	const matchDeckLoop = startMatchDeckJobPolling().catch((err) => {
		log.error("match-deck-poll-loop-error", { error: String(err) });
		Sentry.captureException(err, {
			tags: { loop: "match-deck-jobs" },
		});
	});

	await startPolling();
	await extensionSyncLoop;
	await audioBackfillLoop;
	await matchDeckLoop;

	if (!draining) {
		log.error("poll-loop-exited-unexpectedly");
		Sentry.captureMessage("poll-loop-exited-unexpectedly", "error");
		setUnhealthy();
		process.exit(1);
	}
}

main().catch((err) => {
	log.error("worker-fatal", { error: String(err) });
	Sentry.captureException(err, { tags: { phase: "main" } });
	setUnhealthy();
	// Flush before exit so the event makes it out of the process.
	Sentry.flush(2000).finally(() => process.exit(1));
});

import * as Sentry from "@sentry/bun";
import { workerConfig } from "./config";
import { startDatabaseBackupScheduler } from "./db-backup";
import { setWorkerFatalObserver } from "./fatal-handlers";
import { setShuttingDown, setUnhealthy, startHealthServer } from "./health";
import { startKeepAlive } from "./keep-alive";
import { log } from "./logger";
import { getActiveJobCount, startPolling, stopPolling } from "./poll";
import {
	getActiveWalkthroughPreviewJobCount,
	startWalkthroughPreviewPolling,
	stopWalkthroughPreviewPolling,
} from "./poll-walkthrough-preview";
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

	// Awaited startup recovery pass. If the previous worker crashed mid-job,
	// a stale preview row may still be `running` and holding the unique
	// active-preview index — `ensureWalkthroughPreview` would then observe
	// the dead job and skip creating fresh work. Doing this before any poll
	// loop or claim path opens means the next ensure() sees a clean slate.
	await runDefaultSweepTick();

	const sweep = startDefaultSweep();

	const shutdown = async (signal: string) => {
		if (draining) return;
		draining = true;
		log.info("shutdown-initiated", { signal });

		setShuttingDown();
		stopPolling();
		stopWalkthroughPreviewPolling();
		keepAlive.stop();
		dbBackup.stop();
		sweep.stop();

		const deadline = Date.now() + workerConfig.drainTimeoutMs;
		while (
			(getActiveJobCount() > 0 || getActiveWalkthroughPreviewJobCount() > 0) &&
			Date.now() < deadline
		) {
			log.info("draining", {
				activeJobs: getActiveJobCount(),
				activePreviewJobs: getActiveWalkthroughPreviewJobCount(),
				remainingMs: deadline - Date.now(),
			});
			await Bun.sleep(1000);
		}

		if (getActiveJobCount() > 0 || getActiveWalkthroughPreviewJobCount() > 0) {
			log.warn("drain-timeout", {
				activeJobs: getActiveJobCount(),
				activePreviewJobs: getActiveWalkthroughPreviewJobCount(),
			});
		}

		healthServer.stop();
		await shutdownPostHogOtel();
		log.info("worker-stopped");
		process.exit(0);
	};

	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));

	// Run the walkthrough preview poll loop concurrently. It uses a separate
	// claim RPC, so the two loops never contend for the same row, but it
	// shares the worker process for deployment simplicity.
	const walkthroughPreviewLoop = startWalkthroughPreviewPolling().catch(
		(err) => {
			log.error("walkthrough-preview-poll-loop-error", { error: String(err) });
			Sentry.captureException(err, {
				tags: { loop: "walkthrough-preview" },
			});
		},
	);

	await startPolling();
	await walkthroughPreviewLoop;

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

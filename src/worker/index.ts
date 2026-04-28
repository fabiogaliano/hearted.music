import { Result } from "better-result";
import {
	markDeadLibraryProcessingJobs,
	markDeadWalkthroughPreviewJobs,
	sweepStaleLibraryProcessingJobs,
	sweepStaleWalkthroughPreviewJobs,
} from "@/lib/data/jobs";
import { workerConfig } from "./config";
import { setShuttingDown, setUnhealthy, startHealthServer } from "./health";
import { startKeepAlive } from "./keep-alive";
import { log } from "./logger";
import { getActiveJobCount, startPolling, stopPolling } from "./poll";
import {
	getActiveWalkthroughPreviewJobCount,
	startWalkthroughPreviewPolling,
	stopWalkthroughPreviewPolling,
} from "./poll-walkthrough-preview";

async function runSweepTick(): Promise<void> {
	const swept = await sweepStaleLibraryProcessingJobs(
		workerConfig.staleThreshold,
	);
	if (Result.isError(swept)) {
		log.error("sweep-error", { error: swept.error.message });
	} else if (swept.value.length > 0) {
		log.info("swept-stale-jobs", {
			count: swept.value.length,
			jobIds: swept.value.map((j) => j.id),
		});
	}

	const dead = await markDeadLibraryProcessingJobs(workerConfig.staleThreshold);
	if (Result.isError(dead)) {
		log.error("dead-letter-error", { error: dead.error.message });
	} else if (dead.value.length > 0) {
		log.warn("dead-lettered-jobs", {
			count: dead.value.length,
			jobIds: dead.value.map((j) => j.id),
		});
	}

	// Sibling pass for walkthrough preview jobs. Without this, a stuck preview
	// `running` row holds the unique active-preview index and blocks all
	// subsequent onboarding sessions for that account from re-ensuring.
	const sweptPreview = await sweepStaleWalkthroughPreviewJobs(
		workerConfig.staleThreshold,
	);
	if (Result.isError(sweptPreview)) {
		log.error("preview-sweep-error", { error: sweptPreview.error.message });
	} else if (sweptPreview.value.length > 0) {
		log.info("swept-stale-preview-jobs", {
			count: sweptPreview.value.length,
			jobIds: sweptPreview.value.map((j) => j.id),
		});
	}

	const deadPreview = await markDeadWalkthroughPreviewJobs(
		workerConfig.staleThreshold,
	);
	if (Result.isError(deadPreview)) {
		log.error("preview-dead-letter-error", {
			error: deadPreview.error.message,
		});
	} else if (deadPreview.value.length > 0) {
		log.warn("dead-lettered-preview-jobs", {
			count: deadPreview.value.length,
			jobIds: deadPreview.value.map((j) => j.id),
		});
	}
}

function startSweep(): { stop: () => void } {
	const interval = setInterval(runSweepTick, workerConfig.sweepIntervalMs);
	return { stop: () => clearInterval(interval) };
}

let draining = false;

async function main() {
	log.info("worker-starting", { config: workerConfig });

	const healthServer = startHealthServer();
	log.info("health-server-started", { port: workerConfig.healthPort });

	const keepAlive = startKeepAlive();

	// Awaited startup recovery pass. If the previous worker crashed mid-job,
	// a stale preview row may still be `running` and holding the unique
	// active-preview index — `ensureWalkthroughPreview` would then observe
	// the dead job and skip creating fresh work. Doing this before any poll
	// loop or claim path opens means the next ensure() sees a clean slate.
	await runSweepTick();

	const sweep = startSweep();

	const shutdown = async (signal: string) => {
		if (draining) return;
		draining = true;
		log.info("shutdown-initiated", { signal });

		setShuttingDown();
		stopPolling();
		stopWalkthroughPreviewPolling();
		keepAlive.stop();
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
		},
	);

	await startPolling();
	await walkthroughPreviewLoop;

	if (!draining) {
		log.error("poll-loop-exited-unexpectedly");
		setUnhealthy();
		process.exit(1);
	}
}

main().catch((err) => {
	log.error("worker-fatal", { error: String(err) });
	setUnhealthy();
	process.exit(1);
});
